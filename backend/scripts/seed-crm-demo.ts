import * as db from "../src/dynamodb.js";
import * as Combined from "../src/models/models-combined.js";

// Accounts that should show demo sales data:
//  - ram@gmail.com (sales_rep)
//  - arjun.jaiswal@whizunik.com (sales_rep)
//  - sankalp@whizunik.com (factor_admin — the admin's own CRM tab)
const ACCOUNTS = [
  { label: "ram@gmail.com", id: "d878f4c3-ede6-485c-8ab3-da428af23e31" },
  { label: "arjun.jaiswal@whizunik.com", id: "f82059a9-a21e-45c7-9579-bfc70e095c05" },
  { label: "sankalp@whizunik.com", id: "f9133e76-92bb-46cd-b1b0-bc7d55ad7c4c" },
];

const LEADS: Array<{ clientId: string; name: string; company: string; email: string; phone: string; source: string; status: string; estimatedValue: number; notes: string }> = [];
const OPPS: Array<{ clientId: string; name: string; accountName: string; stage: string; amount: number; probability: number; expectedCloseDate: string }> = [];
const ACTS: Array<{ clientId: string; activityType: string; subject: string; description: string; dueDate: string; completed?: boolean }> = [];

function lead(clientId: string, name: string, company: string, email: string, phone: string, source: string, status: string, estimatedValue: number, notes: string) {
  LEADS.push({ clientId, name, company, email, phone, source, status, estimatedValue, notes });
}
function opp(clientId: string, name: string, accountName: string, stage: string, amount: number, expectedCloseDate: string) {
  const probability: Record<string, number> = { prospecting: 20, qualification: 40, proposal: 60, negotiation: 80, closed_won: 100, closed_lost: 0 };
  OPPS.push({ clientId, name, accountName, stage, amount, probability: probability[stage] ?? 50, expectedCloseDate });
}
function act(clientId: string, activityType: string, subject: string, description: string, dueDate: string, completed = false) {
  ACTS.push({ clientId, activityType, subject, description, dueDate, completed });
}

// ── ram@gmail.com — full sales book ──────────────────────────────────────────
const RAM = ACCOUNTS[0].id;
lead(RAM, "Vikram Malhotra", "Trendline Fashion House", "vikram@trendlinefashion.in", "+91 98110 22014", "website", "new", 850000, "Downloaded Q3 catalogue; interested in factoring-backed credit.");
lead(RAM, "Priya Nair", "Nair Textiles & Co.", "priya@nairtextiles.co.in", "+91 98220 44711", "referral", "contacted", 420000, "Referred by Gupta Wholesale. Wants net-45 terms.");
lead(RAM, "Arjun Mehta", "MetroMart Retail Pvt Ltd", "arjun.mehta@metromart.in", "+91 99870 11933", "event", "qualified", 1200000, "Met at Retail India Expo. Needs invoice funding before festive season.");
lead(RAM, "Sana Sheikh", "UrbanKart Styles", "sana@urbankart.in", "+91 91670 55402", "social", "contacted", 310000, "DM'd on LinkedIn after seeing storm-jacket range.");
lead(RAM, "Rajesh Kumar", "Kumar & Sons Traders", "rajesh@kumarandsons.in", "+91 98100 23410", "walk-in", "new", 180000, "Walked into office; asked about advance rates.");
lead(RAM, "Divya Sharma", "Sharma Garments", "divya@sharmagarments.com", "+91 90040 81122", "cold-call", "qualified", 640000, "Cold call follow-up done; sending proposal.");
lead(RAM, "Amit Verma", "Verma Apparels", "amit@vermaapparels.in", "+91 98550 33009", "website", "lost", 260000, "Went with a bank — keep for renewal next year.");
lead(RAM, "Neha Gupta", "Gupta Wholesale Mart", "neha@guptawholesale.in", "+91 98990 77126", "referral", "converted", 980000, "Signed annual contract; onboarding done.");

opp(RAM, "MetroMart festive season order", "MetroMart Retail Pvt Ltd", "negotiation", 1200000, "2026-10-15");
opp(RAM, "Trendline Q3 apparel line", "Trendline Fashion House", "proposal", 850000, "2026-09-30");
opp(RAM, "Nair Textiles first order", "Nair Textiles & Co.", "qualification", 420000, "2026-11-10");
opp(RAM, "Sharma Garments bulk jackets", "Sharma Garments", "prospecting", 640000, "2026-12-05");
opp(RAM, "Gupta Wholesale annual contract", "Gupta Wholesale Mart", "closed_won", 980000, "2026-08-01");
opp(RAM, "Verma Apparels pilot run", "Verma Apparels", "closed_lost", 260000, "2026-07-20");

act(RAM, "call", "Follow up on MetroMart pricing", "Confirm advance rate and fee structure for festive order.", "2026-08-14");
act(RAM, "email", "Send revised proposal to Trendline", "Attach updated pricing sheet with net-45 terms.", "2026-08-15");
act(RAM, "meeting", "On-site visit — Nair Textiles", "Walk through funding process and credit limits.", "2026-08-20");
act(RAM, "task", "Prepare monthly pipeline report", "Collate stage values for the monthly review.", "2026-08-28");

// ── arjun.jaiswal@whizunik.com — leaner book ────────────────────────────────
const ARJUN = ACCOUNTS[1].id;
lead(ARJUN, "Rohan Gupta", "Rohan Textiles", "rohan@rohantextiles.in", "+91 99010 88231", "website", "new", 520000, "Enquired via site form about factoring limits.");
lead(ARJUN, "Kavita Rao", "Rao Fashion Mart", "kavita@raofashionmart.in", "+91 97670 22018", "referral", "qualified", 730000, "Referred by existing client; ready for proposal.");
lead(ARJUN, "Sameer Khan", "Khan Retailers", "sameer@khanretailers.in", "+91 98180 66402", "walk-in", "contacted", 290000, "Needs short-term funding for stock purchase.");
lead(ARJUN, "Pooja Singh", "Singh Apparel House", "pooja@singhapparel.in", "+91 90260 44812", "social", "new", 410000, "Instagram enquiry; assigned to follow up.");
lead(ARJUN, "Deepak Jain", "Jain Wholesale", "deepak@jainwholesale.in", "+91 98330 11590", "event", "converted", 860000, "Signed at trade fair; first invoice issued.");

opp(ARJUN, "Rao Fashion Mart expansion", "Rao Fashion Mart", "negotiation", 730000, "2026-10-05");
opp(ARJUN, "Rohan Textiles spring line", "Rohan Textiles", "proposal", 520000, "2026-09-22");
opp(ARJUN, "Singh Apparel House Q4", "Singh Apparel House", "qualification", 410000, "2026-11-18");
opp(ARJUN, "Jain Wholesale contract", "Jain Wholesale", "closed_won", 860000, "2026-07-30");

act(ARJUN, "call", "Call Kavita Rao — terms confirmation", "Confirm fee rate before sending proposal.", "2026-08-14");
act(ARJUN, "email", "Send onboarding kit to Jain Wholesale", "Documents for the signed contract.", "2026-08-13", true);
act(ARJUN, "meeting", "Site visit — Rohan Textiles", "Evaluate warehouse and confirm credit need.", "2026-08-21");

// ── sankalp@whizunik.com (admin) — team overview sample ─────────────────────
const ADMIN = ACCOUNTS[2].id;
lead(ADMIN, "Aditya Menon", "Menon Retail Group", "aditya@menonretail.in", "+91 98450 77120", "referral", "qualified", 1100000, "Large group account — multiple brands under one roof.");
lead(ADMIN, "Ritu Kapoor", "Kapoor Garments", "ritu@kapoorgarments.in", "+91 98110 33044", "website", "contacted", 380000, "Asked for advance-rate calculator.");
lead(ADMIN, "Farhan Ali", "Ali Traders", "farhan@alitraders.in", "+91 98920 55213", "cold-call", "new", 220000, "Early stage — needs credit education.");
lead(ADMIN, "Sunita Rao", "Sunita Fabrics", "sunita@sunita fabrics.in".replace(" ", ""), "+91 91230 88907", "event", "converted", 690000, "Converted at fabric expo; repeat orders expected.");

opp(ADMIN, "Menon Retail Group franchise order", "Menon Retail Group", "negotiation", 1100000, "2026-10-30");
opp(ADMIN, "Kapoor Garments first order", "Kapoor Garments", "proposal", 380000, "2026-09-15");
opp(ADMIN, "Sunita Fabrics repeat order", "Sunita Fabrics", "closed_won", 690000, "2026-08-05");

act(ADMIN, "email", "Proposal to Menon Retail Group", "Consolidated terms + limits for the group account.", "2026-08-15");
act(ADMIN, "meeting", "Quarterly sales review", "Pipeline review with both sales reps.", "2026-08-26");

// ── Run ─────────────────────────────────────────────────────────────────────
async function main() {
  const existingLeads = await db.scanByType("Lead");
  const existingOpps = await db.scanByType("Opportunity");
  const existingActs = await db.scanByType("CrmActivity");
  for (const acc of ACCOUNTS) {
    const leadNames = new Set(existingLeads.filter((l: any) => l.clientId === acc.id).map((l: any) => l.name));
    const oppNames = new Set(existingOpps.filter((o: any) => o.clientId === acc.id).map((o: any) => o.name));
    const actSubjects = new Set(existingActs.filter((a: any) => a.clientId === acc.id).map((a: any) => a.subject));

    let cLeads = 0, cOpps = 0, cActs = 0, skipped = 0;
    for (const l of LEADS.filter((x) => x.clientId === acc.id)) {
      if (leadNames.has(l.name)) { skipped++; continue; }
      await Combined.createLead({ ...l, assignedTo: acc.id });
      cLeads++;
    }
    for (const o of OPPS.filter((x) => x.clientId === acc.id)) {
      if (oppNames.has(o.name)) { skipped++; continue; }
      await Combined.createOpportunity({ ...o, assignedTo: acc.id });
      cOpps++;
    }
    for (const a of ACTS.filter((x) => x.clientId === acc.id)) {
      if (actSubjects.has(a.subject)) { skipped++; continue; }
      await Combined.createActivity({ ...a, assignedTo: acc.id, createdBy: acc.id });
      cActs++;
    }
    console.log(`Seeded ${acc.label} → +${cLeads} leads, +${cOpps} opportunities, +${cActs} activities (${skipped} skipped as duplicates)`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("SEED ERROR:", err);
  process.exit(1);
});
