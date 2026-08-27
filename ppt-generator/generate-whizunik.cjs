// WhizUnik — Premium Booklet · 12 slides
// Run: node generate-whizunik.cjs  →  outputs ../whizunik-booklet-premium.pptx
const PptxGenJS = require("pptxgenjs");
const path = require("path");

const pptx = new PptxGenJS();
pptx.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 });
pptx.layout = "WIDE";
pptx.author = "WhizUnik";
pptx.company = "WhizUnik";
pptx.title = "WhizUnik — Business Management Platform · Premium Booklet";
pptx.subject = "12-slide premium booklet";
pptx.theme = { headFontFace: "Georgia", bodyFontFace: "Segoe UI", lang: "en-US" };

// ── Palette ─────────────────────────────────────────────────────
const C = {
  navy: "0B1F33",      // ink navy — main background
  navy2: "142C46",     // lighter navy — panels on dark
  navy3: "081726",     // deepest navy
  gold: "C9A227",      // signature gold
  goldDeep: "A8862A",  // gold on light backgrounds
  goldSoft: "E6D9B8",  // light gold tint
  paper: "F7F4EE",     // ivory paper background
  card: "FDFBF6",      // card on paper / screenshot frame
  ink: "0B1F33",       // text on light
  slate: "5C6B7A",     // muted text on light
  mutedD: "93A5B8",    // muted text on dark
  line: "E0D8C6",      // hairline on light
  lineD: "27415C",     // hairline on dark
  red: "BF6E77",       // soft rose
  green: "2D8077",     // teal green
};
const DISPLAY = "Georgia";
const BODY = "Segoe UI";
const W = 13.333;
const H = 7.5;
const M = 0.55; // left margin
const RIGHT = W - M; // right margin (12.78)

const A = (f) => path.join(__dirname, "assets", "whizunik", f);

// ── Small helpers ───────────────────────────────────────────────
const rect = (s, o) => s.addShape(pptx.ShapeType.rect, o);
const rrect = (s, o) => s.addShape(pptx.ShapeType.roundRect, o);
const ellipse = (s, o) => s.addShape(pptx.ShapeType.ellipse, o);
const arrow = (s, dir, o) => s.addShape(pptx.ShapeType[dir + "Arrow"], o);
const tx = (s, t, o) =>
  s.addText(t, { fontFace: BODY, color: C.ink, margin: 0, ...o });

// Horizontal gold hairline (signature detail)
function goldRule(s, { x, y, w = 0.85, h = 0.035, color = C.goldDeep }) {
  rect(s, { x, y, w, h, fill: { color }, line: { type: "none" } });
}

// Footer: hairline + brand + page number
function footer(s, num) {
  goldRule(s, { x: M, y: 7.04, w: RIGHT - M, h: 0.012, color: C.goldDeep });
  tx(s, "WHIZUNIK · BUSINESS MANAGEMENT PLATFORM", {
    x: M, y: 7.12, w: 9, h: 0.2,
    fontSize: 7, bold: true, color: C.slate, charSpacing: 2.2,
  });
  tx(s, String(num).padStart(2, "0"), {
    x: RIGHT - 0.95, y: 7.06, w: 0.95, h: 0.3, align: "right",
    fontSize: 13, bold: true, color: C.goldDeep, fontFace: DISPLAY,
  });
}

// Brand lockup (top-left)
function brand(s, { x = M, y = 0.58, nameSize = 24 } = {}) {
  tx(s, "WHIZUNIK", {
    x, y, w: 6, h: 0.52,
    fontSize: nameSize, bold: true, color: C.ink, fontFace: DISPLAY, charSpacing: 2.5,
  });
  tx(s, "BUSINESS MANAGEMENT PLATFORM", {
    x: x + 0.06, y: y + 0.54, w: 6, h: 0.22,
    fontSize: 8, bold: true, color: C.slate, charSpacing: 2.8,
  });
}

// Decorative gold rings (cover / CTA)
function rings(s, { x = 10.3, y = 4.55, big = 3.1 } = {}) {
  ellipse(s, {
    x, y, w: big, h: big,
    fill: { type: "none" }, line: { color: C.goldDeep, width: 1.1 },
  });
  ellipse(s, {
    x: x + big * 0.16, y: y + big * 0.16, w: big * 0.68, h: big * 0.68,
    fill: { type: "none" }, line: { color: C.gold, width: 0.75 },
  });
  ellipse(s, {
    x: x + big * 0.52, y: y + big * 0.52, w: 0.16, h: 0.16,
    fill: { color: C.goldDeep }, line: { type: "none" },
  });
}

// Eyebrow (gold, letterspaced)
function eyebrow(s, text, { x = M, y = 0.62, color = C.goldDeep, w = 8, align = "left" } = {}) {
  tx(s, text, {
    x, y, w, h: 0.3, align,
    fontSize: 11, bold: true, color, charSpacing: 3.2,
  });
}

// Gold dot marker + feature row (lead bold white, desc muted)
function feature(s, { x = M, y, lead, desc, dotColor = C.goldDeep }) {
  ellipse(s, {
    x: x + 0.02, y: y + 0.09, w: 0.11, h: 0.11,
    fill: { color: dotColor }, line: { type: "none" },
  });
  tx(s, lead, {
    x: x + 0.34, y, w: 4.75, h: 0.3,
    fontSize: 13, bold: true, color: C.ink,
  });
  tx(s, desc, {
    x: x + 0.34, y: y + 0.32, w: 4.75, h: 0.55,
    fontSize: 10, color: C.slate, valign: "top", lineSpacingMultiple: 1.12,
  });
}

// Screenshot presented in a premium frame (chrome bar + gold spine + shadow).
// imgW/imgH = the image's fitted size; the card is drawn to wrap it exactly,
// so `contain` never letterboxes. Returns the card geometry.
const CHROME_H = 0.5;
const CARD_PAD = 0.12;
function screenCard(s, { img, imgW, imgH, x, y, chrome = true, chromeLabel = "whizunik.com/app", cap = "PRODUCT VIEW · ILLUSTRATIVE", capColor = C.slate }) {
  const chromeH = chrome ? CHROME_H : 0;
  const w = imgW + 2 * CARD_PAD;
  const h = imgH + chromeH + 2 * CARD_PAD;
  // card body (warm paper-white) with soft shadow
  rrect(s, {
    x, y, w, h,
    fill: { color: C.card },
    line: { color: "E4DCC8", width: 1 },
    rectRadius: 0.055,
    shadow: { type: "outer", color: "0B1F33", opacity: 0.28, blur: 9, offset: 3, angle: 45 },
  });
  // gold spine on the left edge
  rect(s, { x: x + 0.028, y: y + 0.06, w: 0.042, h: h - 0.12, fill: { color: C.gold }, line: { type: "none" } });
  let imgTop = y;
  if (chrome) {
    rrect(s, {
      x, y, w, h: chromeH,
      fill: { color: "F1ECDF" }, line: { type: "none" }, rectRadius: 0.055,
    });
    // traffic dots
    ["BF6E77", "D9A441", "2D8077"].forEach((c2, i) =>
      ellipse(s, {
        x: x + 0.2 + i * 0.17, y: y + 0.18, w: 0.1, h: 0.1,
        fill: { color: c2 }, line: { type: "none" },
      })
    );
    // url pill
    rrect(s, {
      x: x + 0.85, y: y + 0.13, w: 2.7, h: 0.24,
      fill: { color: C.card }, line: { color: "E4DCC8", width: 0.75 }, rectRadius: 0.12,
    });
    tx(s, chromeLabel, {
      x: x + 0.85, y: y + 0.13, w: 2.7, h: 0.24,
      align: "center", valign: "middle", fontSize: 7.5, color: C.slate,
    });
    tx(s, "LIVE", {
      x: x + w - 1.0, y: y + 0.13, w: 0.82, h: 0.24,
      align: "right", fontSize: 7, bold: true, color: C.goldDeep, charSpacing: 1.6,
    });
    imgTop = y + chromeH;
  }
  s.addImage({
    path: img,
    x: x + CARD_PAD, y: imgTop + CARD_PAD,
    w: imgW, h: imgH,
    sizing: { type: "contain", w: imgW, h: imgH },
  });
  if (cap) {
    tx(s, cap, {
      x, y: y + h + 0.14, w, h: 0.2,
      fontSize: 7, bold: true, color: capColor, charSpacing: 2.2,
    });
  }
  return { x, y, w, h };
}

// Small value chip under wide screenshots
function chip(s, { x, y, w = 2.2, h = 0.95, value, label, vcolor = C.goldDeep }) {
  rrect(s, {
    x, y, w, h,
    fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.07,
    shadow: { type: "outer", color: "0B1F33", opacity: 0.12, blur: 5, offset: 2, angle: 45 },
  });
  tx(s, value, {
    x: x + 0.18, y: y + 0.13, w: w - 0.36, h: 0.32,
    fontSize: 14.5, bold: true, color: vcolor,
  });
  tx(s, label, {
    x: x + 0.18, y: y + 0.5, w: w - 0.36, h: 0.34,
    fontSize: 7.5, bold: true, color: C.slate, charSpacing: 1.1, valign: "top",
  });
}

// Standard navy product page — returns slide + geometry so the caller
// can draw the right-hand visual.
function productPage({ num, module, eyebrowT, title, sub, features }) {
  const s = pptx.addSlide();
  s.background = { color: C.paper };
  goldRule(s, { x: M, y: 0.34, w: 0.5, h: 0.028 });
  // module tag top-right
  tx(s, module, {
    x: 8.6, y: 0.56, w: 4.18, h: 0.25, align: "right",
    fontSize: 8.5, bold: true, color: C.slate, charSpacing: 2.6,
  });
  eyebrow(s, eyebrowT);
  tx(s, title, {
    x: M, y: 0.98, w: 5.0, h: 1.02,
    fontSize: 25, color: C.ink, fontFace: DISPLAY, valign: "top", lineSpacingMultiple: 1.04,
  });
  goldRule(s, { x: M, y: 2.12, w: 0.85 });
  tx(s, sub, {
    x: M, y: 2.24, w: 5.0, h: 0.82,
    fontSize: 11.5, italic: true, color: C.slate, valign: "top", lineSpacingMultiple: 1.14,
  });
  let fy = 3.18;
  for (const f of features) {
    feature(s, { y: fy, lead: f.lead, desc: f.desc });
    fy += 1.04;
  }
  footer(s, num);
  return s;
}

// Size an image to fit inside (maxW x maxH) preserving aspect
function fit(imgW, imgH, maxW, maxH) {
  const scale = Math.min(maxW / imgW, maxH / imgH);
  return { w: imgW * scale, h: imgH * scale };
}

// ════════════════════════════════════════════════════════════════
// SLIDE 1 — COVER (navy)
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  s.background = { color: C.paper };
  // top hairline
  goldRule(s, { x: 0, y: 0.0, w: W, h: 0.03 });
  brand(s);
  // eyebrow chip
  rrect(s, {
    x: M, y: 1.62, w: 3.3, h: 0.4,
    fill: { type: "none" }, line: { color: C.goldDeep, width: 1.1 }, rectRadius: 0.2,
  });
  tx(s, "PREMIUM BOOKLET · PRODUCT GUIDE", {
    x: M, y: 1.62, w: 3.3, h: 0.4,
    align: "center", valign: "middle", fontSize: 8.5, bold: true, color: C.goldDeep, charSpacing: 1.8,
  });
  // headline
  tx(s, "Every moving part.", {
    x: M, y: 2.35, w: 8.4, h: 0.95,
    fontSize: 44, color: C.ink, fontFace: DISPLAY, bold: false,
  });
  tx(s, "One clear decision.", {
    x: M, y: 3.28, w: 8.4, h: 0.95,
    fontSize: 44, color: C.goldDeep, fontFace: DISPLAY,
  });
  goldRule(s, { x: M, y: 4.42, w: 1.35, h: 0.04 });
  tx(s, "A premium operating view for promoters and leadership teams.", {
    x: M, y: 4.62, w: 6.4, h: 0.6,
    fontSize: 15, color: C.slate, lineSpacingMultiple: 1.2,
  });
  // decorative rings
  rings(s, { x: 10.15, y: 4.35, big: 3.3 });
  // bottom
  tx(s, "WHIZUNIK · BUSINESS MANAGEMENT PLATFORM", {
    x: M, y: 7.06, w: 9, h: 0.2,
    fontSize: 7, bold: true, color: C.slate, charSpacing: 2.2,
  });
  tx(s, "01", {
    x: RIGHT - 0.95, y: 7.0, w: 0.95, h: 0.3, align: "right",
    fontSize: 13, bold: true, color: C.goldDeep, fontFace: DISPLAY,
  });
  s.addNotes("Cover. WhizUnik gives promoters and leadership teams a premium operating view of the business — sales, demand, stock and cash in one place.");
}

// ════════════════════════════════════════════════════════════════
// SLIDE 2 — THE LEADERSHIP PROBLEM (paper)
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  s.background = { color: C.paper };
  goldRule(s, { x: M, y: 0.34, w: 0.5, h: 0.028 });
  eyebrow(s, "THE LEADERSHIP PROBLEM");
  tx(s, "The business does not run in departments. Neither should management visibility.", {
    x: M, y: 0.98, w: 5.2, h: 1.7,
    fontSize: 25, color: C.ink, fontFace: DISPLAY, valign: "top", lineSpacingMultiple: 1.1,
  });
  goldRule(s, { x: M, y: 2.84, w: 0.85 });
  tx(s, "WhizUnik brings the commercial, operational and financial signals together — so management can understand the business and act early.", {
    x: M, y: 2.98, w: 5.2, h: 1.1,
    fontSize: 11.5, italic: true, color: C.slate, valign: "top", lineSpacingMultiple: 1.2,
  });
  // three quiet markers
  [["ONE VIEW", "Commercial, operational and financial signals in one place."],
   ["ONE LANGUAGE", "Sales, stock and cash talked about together."],
   ["ONE RHYTHM", "Early action instead of late surprises."],
  ].forEach(([lead, desc], i) => {
    const y = 4.3 + i * 0.78;
    ellipse(s, { x: M + 0.02, y: y + 0.07, w: 0.11, h: 0.11, fill: { color: C.goldDeep }, line: { type: "none" } });
    tx(s, lead, { x: M + 0.34, y, w: 4.8, h: 0.28, fontSize: 11, bold: true, color: C.ink, charSpacing: 1.2 });
    tx(s, desc, { x: M + 0.34, y: y + 0.3, w: 4.8, h: 0.4, fontSize: 9.5, color: C.slate });
  });
  // right: photo in a frame (no chrome — it is a photo)
  const f = fit(1352, 901, 6.35, 4.3);
  const fx = RIGHT - f.w - CARD_PAD * 2, fy = 1.15;
  screenCard(s, {
    img: A("image1.png"), imgW: f.w, imgH: f.h, x: fx, y: fy, chrome: false,
    cap: "THE OPERATING VIEW · ILLUSTRATIVE",
  });
  footer(s, 2);
  s.addNotes("The leadership problem: departments each hold a piece of the truth. WhizUnik connects the signals so management can see the whole business and act early.");
}

// ════════════════════════════════════════════════════════════════
// SLIDE 3 — LIVE · THE PROMOTER VIEW
// ════════════════════════════════════════════════════════════════
{
  const s = productPage({
    num: 3,
    module: "MODULE 01 / 07",
    eyebrowT: "LIVE · THE PROMOTER VIEW",
    title: "The whole business, at a glance.",
    sub: "A concise leadership screen that connects the signals which previously sat with separate teams and systems.",
    features: [
      { lead: "See it together", desc: "Sales, demand, stock risk and cash priorities on one screen." },
      { lead: "Decide, don't update", desc: "Focus the management meeting on decisions, not status." },
      { lead: "Act before it escalates", desc: "Daily alerts assign action while there is still time." },
    ],
  });
  const f = fit(1536, 1024, 6.6, 4.35);
  const cx = RIGHT - f.w - CARD_PAD * 2, cy = 1.1;
  screenCard(s, { img: A("image2.png"), imgW: f.w, imgH: f.h, x: cx, y: cy, chromeLabel: "whizunik.com/app/overview" });
  s.addNotes("The promoter view: one leadership screen for sales, demand, stock risk and cash priorities. Management meetings become decision meetings.");
}

// ════════════════════════════════════════════════════════════════
// SLIDE 4 — DEMAND INTELLIGENCE
// ════════════════════════════════════════════════════════════════
{
  const s = productPage({
    num: 4,
    module: "MODULE 02 / 07",
    eyebrowT: "DEMAND INTELLIGENCE",
    title: "Forecast and reorder with confidence.",
    sub: "Movement history turned into a practical view of future demand — and the stock decisions required now.",
    features: [
      { lead: "Forecast", desc: "Monthly demand from weighted baseline, trend and seasonality." },
      { lead: "Cover", desc: "Days of cover, stockout risk and reorder-by date." },
      { lead: "Reorder", desc: "Recommended order from demand, lead time and safety buffer." },
    ],
  });
  const f = fit(867, 515, 6.6, 4.35);
  const cx = RIGHT - f.w - CARD_PAD * 2, cy = 1.1;
  screenCard(s, { img: A("image3.png"), imgW: f.w, imgH: f.h, x: cx, y: cy, chromeLabel: "whizunik.com/app/demand" });
  s.addNotes("Demand intelligence: a monthly forecast from weighted baseline, trend and seasonality, with days of cover, stockout risk and a recommended reorder quantity.");
}

// ════════════════════════════════════════════════════════════════
// SLIDE 5 — COMMERCIAL ACTION (portrait screenshot + pricing levers)
// ════════════════════════════════════════════════════════════════
{
  const s = productPage({
    num: 5,
    module: "MODULE 03 / 07",
    eyebrowT: "COMMERCIAL ACTION",
    title: "Protect margin. Release excess stock.",
    sub: "Stock position and sales behaviour translated into a pricing indication that supports commercial judgement.",
    features: [
      { lead: "Momentum", desc: "Velocity flags products gaining or losing pace." },
      { lead: "Guardrail", desc: "Hold, increase or reduce price within a minimum margin." },
      { lead: "Release", desc: "Excess-stock insight shows where action pays." },
    ],
  });
  // pricing-levers panel (left of the portrait screenshot)
  const pX = 5.72, pY = 1.62, pW = 2.28, pH = 3.85;
  rrect(s, {
    x: pX, y: pY, w: pW, h: pH,
    fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.08,
  });
  tx(s, "PRICING LEVERS", {
    x: pX + 0.2, y: pY + 0.18, w: pW - 0.4, h: 0.24,
    fontSize: 8, bold: true, color: C.goldDeep, charSpacing: 2.2,
  });
  const levers = [
    ["INCREASE", "momentum strong", C.green],
    ["HOLD", "within guardrail", C.gold],
    ["REDUCE", "excess stock, slow pace", C.red],
  ];
  levers.forEach(([label, note, col], i) => {
    const y = pY + 0.52 + i * 0.78;
    ellipse(s, { x: pX + 0.24, y: y + 0.06, w: 0.12, h: 0.12, fill: { color: col }, line: { type: "none" } });
    tx(s, label, { x: pX + 0.52, y, w: pW - 0.7, h: 0.26, fontSize: 11.5, bold: true, color: C.ink });
    tx(s, note, { x: pX + 0.52, y: y + 0.28, w: pW - 0.7, h: 0.24, fontSize: 8.5, color: C.slate });
  });
  tx(s, "Every move is checked against a minimum-margin guardrail.", {
    x: pX + 0.2, y: pY + pH - 0.9, w: pW - 0.4, h: 0.7,
    fontSize: 8, italic: true, color: C.slate, lineSpacingMultiple: 1.15,
  });
  // portrait screenshot
  const f = fit(571, 621, 6.6, 4.35);
  const cx = RIGHT - f.w - CARD_PAD * 2, cy = 1.1;
  screenCard(s, { img: A("image4.png"), imgW: f.w, imgH: f.h, x: cx, y: cy, chromeLabel: "whizunik.com/app/pricing" });
  s.addNotes("Commercial action: momentum and velocity show which products are gaining or losing pace. Price levers (hold / increase / reduce) are always checked against a minimum-margin guardrail, and excess stock is flagged for release.");
}

// ════════════════════════════════════════════════════════════════
// SLIDE 6 — SALES EXECUTION
// ════════════════════════════════════════════════════════════════
{
  const s = productPage({
    num: 6,
    module: "MODULE 04 / 07",
    eyebrowT: "SALES EXECUTION",
    title: "Every account has an owner and a next move.",
    sub: "The complete sales motion across retailers, marketplaces, stores, institutions and gifting.",
    features: [
      { lead: "Pipeline", desc: "Lead stages, opportunity value, visits, tasks and timelines." },
      { lead: "Accountability", desc: "Every salesperson has KPIs and clear ownership." },
      { lead: "Coverage", desc: "Neglected accounts and priorities visible from one place." },
    ],
  });
  const f = fit(1582, 614, 6.6, 4.35);
  const cx = RIGHT - f.w - CARD_PAD * 2, cy = 1.1;
  const g6 = screenCard(s, { img: A("image5.png"), imgW: f.w, imgH: f.h, x: cx, y: cy, chromeLabel: "whizunik.com/app/sales" });
  const chipW6 = (g6.w - 0.36) / 3;
  chip(s, { x: g6.x, y: g6.y + g6.h + 0.42, w: chipW6, value: "100%", label: "ACCOUNTS WITH AN OWNER" });
  chip(s, { x: g6.x + chipW6 + 0.18, y: g6.y + g6.h + 0.42, w: chipW6, value: "KPI", label: "PER SALESPERSON" });
  chip(s, { x: g6.x + 2 * (chipW6 + 0.18), y: g6.y + g6.h + 0.42, w: chipW6, value: "1 TRAIL", label: "VISITS · TASKS · TIMELINES" });
  s.addNotes("Sales execution: every account has an owner and a next move. Lead stages, opportunities, visits, tasks and KPIs give each salesperson clear accountability — and neglected accounts surface automatically.");
}

// ════════════════════════════════════════════════════════════════
// SLIDE 7 — WORKING CAPITAL (light mockup, built from shapes)
// ════════════════════════════════════════════════════════════════
{
  const s = productPage({
    num: 7,
    module: "MODULE 05 / 07",
    eyebrowT: "WORKING CAPITAL",
    title: "Collections become a management priority.",
    sub: "A live debtor view tells the team what is overdue, who needs a call and where cash is concentrated.",
    features: [
      { lead: "Ageing", desc: "Invoice ageing and overdue alerts, live." },
      { lead: "Follow-up", desc: "Payment reminders with an assigned next action." },
      { lead: "Concentration", desc: "Customer concentration visible to leadership." },
    ],
  });
  // ── light-theme screen mockup ──
  const mX = 5.72, mY = 1.1, mW = 7.0, mH = 5.0;
  // outer frame
  rrect(s, {
    x: mX, y: mY, w: mW, h: mH,
    fill: { color: C.card }, line: { color: "E4DCC8", width: 1 }, rectRadius: 0.055,
    shadow: { type: "outer", color: "0B1F33", opacity: 0.28, blur: 9, offset: 3, angle: 45 },
  });
  rect(s, { x: mX + 0.028, y: mY + 0.06, w: 0.042, h: mH - 0.12, fill: { color: C.gold }, line: { type: "none" } });
  // chrome
  rrect(s, { x: mX, y: mY, w: mW, h: CHROME_H, fill: { color: "F1ECDF" }, line: { type: "none" }, rectRadius: 0.055 });
  ["BF6E77", "D9A441", "2D8077"].forEach((c2, i) =>
    ellipse(s, { x: mX + 0.2 + i * 0.17, y: mY + 0.18, w: 0.1, h: 0.1, fill: { color: c2 }, line: { type: "none" } })
  );
  rrect(s, { x: mX + 0.85, y: mY + 0.13, w: 2.7, h: 0.24, fill: { color: C.card }, line: { color: "E4DCC8", width: 0.75 }, rectRadius: 0.12 });
  tx(s, "whizunik.com/app/collections", {
    x: mX + 0.85, y: mY + 0.13, w: 2.7, h: 0.24,
    align: "center", valign: "middle", fontSize: 7.5, color: C.slate,
  });
  tx(s, "LIVE", {
    x: mX + mW - 1.0, y: mY + 0.13, w: 0.82, h: 0.24,
    align: "right", fontSize: 7, bold: true, color: C.goldDeep, charSpacing: 1.6,
  });
  const cTop = mY + CHROME_H;
  const cx0 = mX + 0.24, cw = mW - 0.48;
  // screen title
  tx(s, "Working Capital", { x: cx0, y: cTop + 0.16, w: cw, h: 0.32, fontSize: 14, bold: true, color: C.ink });
  tx(s, "Debtor book · ageing · follow-up", { x: cx0, y: cTop + 0.48, w: cw, h: 0.2, fontSize: 8, color: C.slate, charSpacing: 1 });
  // KPI tiles
  const kpis = [
    ["Overdue balance", "₹38.2L", C.red],
    ["Collection rate", "91.4%", C.green],
    ["Accounts to call", "12", "C9A227"],
  ];
  const tileW = (cw - 0.32) / 3;
  kpis.forEach(([label, value, col], i) => {
    const x = cx0 + i * (tileW + 0.16);
    rrect(s, { x, y: cTop + 0.82, w: tileW, h: 0.82, fill: { color: "F4F0E5" }, line: { color: "E4DCC8", width: 0.75 }, rectRadius: 0.06 });
    tx(s, label.toUpperCase(), { x: x + 0.12, y: cTop + 0.91, w: tileW - 0.24, h: 0.18, fontSize: 6.5, bold: true, color: C.slate, charSpacing: 0.8 });
    tx(s, value, { x: x + 0.12, y: cTop + 1.1, w: tileW - 0.24, h: 0.32, fontSize: 15, bold: true, color: col });
  });
  // debtor rows
  const rows = [
    ["Apex Retail", "₹12.4L", "Overdue 45d", C.red, "REMINDER SENT"],
    ["Vega Stores", "₹9.8L", "Overdue 21d", "C9A227", "FOLLOW-UP"],
    ["Northwind Mart", "₹6.1L", "Due in 5d", C.green, "ON TRACK"],
    ["Summit Traders", "₹4.2L", "Overdue 60d", C.red, "ESCALATE"],
  ];
  rows.forEach(([name, amt, age, col, pill], i) => {
    const y = cTop + 1.78 + i * 0.56;
    rrect(s, { x: cx0, y, w: cw, h: 0.5, fill: { color: "FDFBF6" }, line: { color: "E8E0CC", width: 0.75 }, rectRadius: 0.05 });
    tx(s, name, { x: cx0 + 0.16, y, w: 2.2, h: 0.5, fontSize: 10, bold: true, color: C.ink, valign: "middle" });
    tx(s, amt, { x: cx0 + 2.45, y, w: 1.0, h: 0.5, fontSize: 10, bold: true, color: C.ink, valign: "middle" });
    tx(s, age, { x: cx0 + 3.5, y, w: 1.35, h: 0.5, fontSize: 8.5, color: col, bold: true, valign: "middle" });
    rrect(s, { x: cx0 + 4.9, y: y + 0.11, w: 1.75, h: 0.28, fill: { color: "F4F0E5" }, line: { type: "none" }, rectRadius: 0.14 });
    tx(s, pill, { x: cx0 + 4.9, y: y + 0.11, w: 1.75, h: 0.28, align: "center", valign: "middle", fontSize: 6.5, bold: true, color: C.slate, charSpacing: 0.8 });
  });
  tx(s, "Cash concentration — Apex Retail holds 32% of receivables. Leadership is alerted before it becomes a risk.", {
    x: cx0, y: cTop + 4.06, w: cw, h: 0.28,
    fontSize: 7.5, italic: true, color: C.slate,
  });
  tx(s, "ILLUSTRATIVE MOCKUP", {
    x: mX, y: mY + mH + 0.14, w: mW, h: 0.2,
    fontSize: 7, bold: true, color: C.slate, charSpacing: 2.2,
  });
  s.addNotes("Working capital: invoice ageing and overdue alerts, payment reminders with assigned follow-up, and customer concentration visible to leadership. The screen shown is an illustrative light-theme mockup — replace with a live screenshot.");
}

// ════════════════════════════════════════════════════════════════
// SLIDE 8 — PURCHASE CONTROL
// ════════════════════════════════════════════════════════════════
{
  const s = productPage({
    num: 8,
    module: "MODULE 06 / 07",
    eyebrowT: "PURCHASE CONTROL",
    title: "Supplier documents and stock movement, connected.",
    sub: "The purchase journey from supplier proforma to goods received and payment — with a clear operational trail.",
    features: [
      { lead: "Trail", desc: "Supplier PI, PO, GRN and purchase invoice linked." },
      { lead: "Visibility", desc: "Incoming stock, delivery status and due dates." },
      { lead: "Accuracy", desc: "Inventory movement tied to the business event." },
    ],
  });
  const f = fit(1554, 788, 6.6, 4.35);
  const cx = RIGHT - f.w - CARD_PAD * 2, cy = 1.1;
  const g8 = screenCard(s, { img: A("image6.png"), imgW: f.w, imgH: f.h, x: cx, y: cy, chromeLabel: "whizunik.com/app/purchases" });
  const chipW8 = (g8.w - 0.36) / 3;
  chip(s, { x: g8.x, y: g8.y + g8.h + 0.42, w: chipW8, value: "PI → PO", label: "→ GRN → INVOICE" });
  chip(s, { x: g8.x + chipW8 + 0.18, y: g8.y + g8.h + 0.42, w: chipW8, value: "LIVE", label: "SUPPLIER DUE DATES" });
  chip(s, { x: g8.x + 2 * (chipW8 + 0.18), y: g8.y + g8.h + 0.42, w: chipW8, value: "1:1", label: "MOVEMENT ↔ EVENT" });
  s.addNotes("Purchase control: the supplier PI, PO, GRN and purchase invoice stay linked, incoming stock and due dates are visible, and inventory movement is tied to the actual business event.");
}

// ════════════════════════════════════════════════════════════════
// SLIDE 9 — TREASURY
// ════════════════════════════════════════════════════════════════
{
  const s = productPage({
    num: 9,
    module: "MODULE 07 / 07",
    eyebrowT: "TREASURY",
    title: "Expected inflows and planned outflows, together.",
    sub: "Receivables, payables and planned payment commitments brought into one decision view.",
    features: [
      { lead: "Collections", desc: "Expected inflows prioritise supplier payments." },
      { lead: "Pressure", desc: "Upcoming cash pressure flagged before payment dates." },
      { lead: "Alignment", desc: "Commercial and finance teams on the same picture." },
    ],
  });
  const f = fit(1623, 659, 6.6, 4.35);
  const cx = RIGHT - f.w - CARD_PAD * 2, cy = 1.1;
  const g9 = screenCard(s, { img: A("image7.png"), imgW: f.w, imgH: f.h, x: cx, y: cy, chromeLabel: "whizunik.com/app/treasury" });
  const chipW9 = (g9.w - 0.36) / 3;
  chip(s, { x: g9.x, y: g9.y + g9.h + 0.42, w: chipW9, value: "42.6L", label: "EXPECTED COLLECTIONS", vcolor: C.green });
  chip(s, { x: g9.x + chipW9 + 0.18, y: g9.y + g9.h + 0.42, w: chipW9, value: "12.1L", label: "SUPPLIER COMMITMENTS", vcolor: C.red });
  chip(s, { x: g9.x + 2 * (chipW9 + 0.18), y: g9.y + g9.h + 0.42, w: chipW9, value: "30d", label: "CASH PRESSURE WINDOW" });
  s.addNotes("Treasury: expected inflows and planned outflows in one view. Supplier payments are prioritised with visibility of expected collections, and cash pressure is flagged before the payment date arrives.");
}

// ════════════════════════════════════════════════════════════════
// SLIDE 10 — CONNECTED ACTIVITY (4-step process)
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  s.background = { color: C.paper };
  goldRule(s, { x: M, y: 0.34, w: 0.5, h: 0.028 });
  eyebrow(s, "CONNECTED ACTIVITY");
  tx(s, "One event. A smarter business view.", {
    x: M, y: 0.98, w: 11, h: 0.62,
    fontSize: 27, color: C.ink, fontFace: DISPLAY,
  });
  goldRule(s, { x: M, y: 1.74, w: 0.85 });
  tx(s, "Every confirmed sale, dispatch, receipt, invoice or payment updates the management picture that matters.", {
    x: M, y: 1.86, w: 8.6, h: 0.5,
    fontSize: 12, italic: true, color: C.slate,
  });
  const steps = [
    { n: "01", t: "ACTIVITY", d: "A sale, receipt, dispatch or payment is recorded." },
    { n: "02", t: "POSITION", d: "Stock, sales, cash or customer position updates." },
    { n: "03", t: "PRIORITY", d: "The platform highlights the risk or opportunity." },
    { n: "04", t: "ACTION", d: "Management sees the right next move." },
  ];
  const cardW = 2.82, gap = 0.3, startX = M;
  steps.forEach((st, i) => {
    const x = startX + i * (cardW + gap);
    const y = 2.85, h = 3.35;
    rrect(s, {
      x, y, w: cardW, h,
      fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.08,
    });
    // oversized serif numeral
    tx(s, st.n, {
      x: x + 0.22, y: y + 0.18, w: 1.2, h: 0.62,
      fontSize: 30, bold: true, color: C.goldDeep, fontFace: DISPLAY,
    });
    goldRule(s, { x: x + 0.24, y: y + 0.98, w: 0.5, h: 0.028 });
    tx(s, st.t, {
      x: x + 0.24, y: y + 1.14, w: cardW - 0.48, h: 0.3,
      fontSize: 12.5, bold: true, color: C.ink, charSpacing: 2,
    });
    tx(s, st.d, {
      x: x + 0.24, y: y + 1.52, w: cardW - 0.48, h: 1.4,
      fontSize: 10, color: C.slate, valign: "top", lineSpacingMultiple: 1.25,
    });
    if (i < 3) {
      arrow(s, "right", {
        x: x + cardW + gap / 2 - 0.08, y: y + h / 2 - 0.12, w: 0.18, h: 0.24,
        fill: { color: C.goldDeep }, line: { type: "none" },
      });
    }
  });
  // closing line
  tx(s, "The platform connects the operational event to the financial position — automatically, in real time.", {
    x: M, y: 6.35, w: 12.2, h: 0.35, align: "center",
    fontSize: 11, italic: true, color: C.slate,
  });
  footer(s, 10);
  s.addNotes("Connected activity: every operational event (sale, dispatch, receipt, invoice, payment) flows into the position, surfaces a priority, and points management to the next action.");
}

// ════════════════════════════════════════════════════════════════
// SLIDE 11 — EXECUTIVE CARE (paper, 4 cards + navy band)
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  s.background = { color: C.paper };
  goldRule(s, { x: M, y: 0.34, w: 0.5, h: 0.028 });
  eyebrow(s, "WHIZUNIK · EXECUTIVE CARE");
  tx(s, "A premium platform. Backed by people.", {
    x: M, y: 0.98, w: 11, h: 0.62,
    fontSize: 27, color: C.ink, fontFace: DISPLAY,
  });
  goldRule(s, { x: M, y: 1.74, w: 0.85 });
  tx(s, "Premium service is part of the relationship — not an afterthought.", {
    x: M, y: 1.86, w: 8.6, h: 0.4,
    fontSize: 12, italic: true, color: C.slate,
  });
  const cards = [
    { n: "01", t: "Designated Relationship Manager", d: "One accountable point of contact for the business." },
    { n: "02", t: "Priority Support", d: "Real-time troubleshooting and structured escalation." },
    { n: "03", t: "Executive Reviews", d: "Regular review of business priorities and adoption." },
    { n: "04", t: "Continuous Optimisation", d: "Dashboards and workflows evolve as the business changes." },
  ];
  const cardW = 5.92, cardH = 1.75, gapX = 0.4, gapY = 0.26;
  cards.forEach((c, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = M + col * (cardW + gapX);
    const y = 2.5 + row * (cardH + gapY);
    rrect(s, {
      x, y, w: cardW, h: cardH,
      fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.07,
      shadow: { type: "outer", color: "0B1F33", opacity: 0.12, blur: 6, offset: 2, angle: 45 },
    });
    tx(s, c.n, {
      x: x + 0.24, y: y + 0.16, w: 0.9, h: 0.46,
      fontSize: 21, bold: true, color: C.goldDeep, fontFace: DISPLAY,
    });
    goldRule(s, { x: x + 0.26, y: y + 0.74, w: 0.45, h: 0.026 });
    tx(s, c.t, {
      x: x + 0.26, y: y + 0.86, w: cardW - 0.52, h: 0.32,
      fontSize: 13.5, bold: true, color: C.ink,
    });
    tx(s, c.d, {
      x: x + 0.26, y: y + 1.24, w: cardW - 0.52, h: 0.44,
      fontSize: 10, color: C.slate, valign: "top",
    });
  });
  // navy closing band
  rrect(s, {
    x: M, y: 6.4, w: RIGHT - M, h: 0.55,
    fill: { color: C.navy }, line: { type: "none" }, rectRadius: 0.06,
  });
  tx(s, "Your accounting system records the books. WhizUnik helps management run the business.", {
    x: M + 0.3, y: 6.4, w: RIGHT - M - 0.6, h: 0.55,
    align: "center", valign: "middle", fontSize: 12.5, italic: true, color: "FFFFFF", fontFace: DISPLAY,
  });
  footer(s, 11);
  s.addNotes("Executive care: a designated relationship manager, priority support with structured escalation, regular executive reviews, and continuous optimisation of dashboards and workflows.");
}

// ════════════════════════════════════════════════════════════════
// SLIDE 12 — NEXT STEP (navy)
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  s.background = { color: C.paper };
  goldRule(s, { x: 0, y: 0.0, w: W, h: 0.03 });
  brand(s);
  tx(s, "NEXT STEP", {
    x: M, y: 1.7, w: 5, h: 0.3,
    fontSize: 11, bold: true, color: C.goldDeep, charSpacing: 3.2,
  });
  tx(s, "One view of the business.", {
    x: M, y: 2.08, w: 9.5, h: 0.85,
    fontSize: 40, color: C.ink, fontFace: DISPLAY,
  });
  tx(s, "Better decisions every day.", {
    x: M, y: 2.92, w: 9.5, h: 0.85,
    fontSize: 40, color: C.goldDeep, fontFace: DISPLAY,
  });
  goldRule(s, { x: M, y: 4.02, w: 1.35, h: 0.04 });
  tx(s, "A guided WhizUnik discovery session — walk the platform with your own numbers.", {
    x: M, y: 4.22, w: 7.6, h: 0.6,
    fontSize: 14, color: C.slate, lineSpacingMultiple: 1.2,
  });
  // journey chips
  const journey = ["DISCOVER", "CONFIGURE", "PILOT", "SCALE"];
  journey.forEach((j, i) => {
    const x = M + i * 1.62;
    rrect(s, {
      x, y: 5.15, w: 1.5, h: 0.4,
      fill: { type: "none" }, line: { color: C.goldDeep, width: 1 }, rectRadius: 0.2,
    });
    tx(s, j, { x, y: 5.15, w: 1.5, h: 0.4, align: "center", valign: "middle", fontSize: 8.5, bold: true, color: C.goldDeep, charSpacing: 1.4 });
    if (i < 3) tx(s, "·", { x: x + 1.42, y: 5.15, w: 0.28, h: 0.4, align: "center", valign: "middle", fontSize: 12, color: C.goldDeep });
  });
  // contact block
  tx(s, "www.whizunik.com", {
    x: M, y: 5.95, w: 4, h: 0.4,
    fontSize: 15, bold: true, color: C.ink,
    hyperlink: { url: "https://www.whizunik.com", tooltip: "Open whizunik.com" },
  });
  tx(s, "[ add contact details ]", {
    x: M + 2.6, y: 6.06, w: 3.4, h: 0.3,
    fontSize: 10, color: C.slate, italic: true,
  });
  rings(s, { x: 10.15, y: 4.35, big: 3.3 });
  tx(s, "12", {
    x: RIGHT - 0.95, y: 7.0, w: 0.95, h: 0.3, align: "right",
    fontSize: 13, bold: true, color: C.goldDeep, fontFace: DISPLAY,
  });
  s.addNotes("Next step: a guided WhizUnik discovery session. Discover, configure, pilot, scale. Contact via www.whizunik.com.");
}

// ── Write ───────────────────────────────────────────────────────
const out = path.join(__dirname, "..", "whizunik-booklet-premium.pptx");
pptx
  .writeFile({ fileName: out })
  .then(() => console.log("Wrote", out))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
