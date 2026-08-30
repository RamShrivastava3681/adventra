// Adventra platform walkthrough deck — 12 slides
// Run: node generate.cjs  →  outputs ../Adventra-Platform-Walkthrough.pptx
const PptxGenJS = require("pptxgenjs");

const pptx = new PptxGenJS();
pptx.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 });
pptx.layout = "WIDE";
pptx.author = "Adventra";
pptx.company = "Adventra";
pptx.title = "Adventra — Receivables Factoring & Monitoring Platform";
pptx.subject = "12-slide platform walkthrough";
pptx.theme = { headFontFace: "Segoe UI", bodyFontFace: "Segoe UI", lang: "en-US" };

// ── Palette ─────────────────────────────────────────────────────
const C = {
  navy: "0A2540",
  navySoft: "12335C",
  blue: "0066FF",
  cyan: "00B8FF",
  bg: "F7F9FC",
  card: "FFFFFF",
  ink: "0B1B33",
  slate: "5A6B8C",
  muted: "94A3B8",
  line: "E2E8F0",
  green: "10B981",
  amber: "F59E0B",
  red: "EF4444",
  greenSoft: "E7F8F1",
  amberSoft: "FEF3E2",
  redSoft: "FDEBEB",
  blueSoft: "E6F0FF",
  cyanSoft: "E6F7FE",
  navySoft2: "16325C",
};
const FONT = "Segoe UI";
const W = 13.333;
const H = 7.5;

// ── Small helpers ───────────────────────────────────────────────
const rect = (s, o) => s.addShape(pptx.ShapeType.rect, o);
const rrect = (s, o) => s.addShape(pptx.ShapeType.roundRect, o);
const ellipse = (s, o) => s.addShape(pptx.ShapeType.ellipse, o);
const line = (s, o) => s.addShape(pptx.ShapeType.line, o);
const arrow = (s, dir, o) => s.addShape(pptx.ShapeType[dir + "Arrow"], o);
const tx = (s, t, o) =>
  s.addText(t, {
    fontFace: FONT,
    color: C.ink,
    margin: 0,
    ...o,
  });

// Decorative soft background + footer
function deco(s, num, opts = {}) {
  s.background = { color: C.bg };
  if (opts.dark) s.background = { color: C.navy };
  ellipse(s, {
    x: W - 2.6, y: -1.4, w: 3.6, h: 3.6,
    fill: { color: opts.dark ? C.navySoft2 : C.cyanSoft }, line: { type: "none" },
  });
  ellipse(s, {
    x: W - 1.4, y: 0.5, w: 1.1, h: 1.1,
    fill: { color: opts.dark ? C.blue : C.blueSoft }, line: { type: "none" },
  });
  if (!opts.dark) {
    tx(s, "Adventra — Receivables Factoring & Monitoring", {
      x: 0.55, y: H - 0.42, w: 7, h: 0.28,
      fontSize: 8.5, color: C.muted, charSpacing: 0.6,
    });
    tx(s, String(num).padStart(2, "0") + " / 12", {
      x: W - 1.6, y: H - 0.42, w: 1.05, h: 0.28,
      fontSize: 8.5, color: C.muted, align: "right",
    });
  } else {
    tx(s, "Adventra · v2.4", {
      x: 0.55, y: H - 0.42, w: 4, h: 0.28,
      fontSize: 8.5, color: "8FA3C4",
    });
  }
}

// Eyebrow + title + accent bar + subtitle (light slides)
function header(s, { eyebrow, title, subtitle, dark = false }) {
  const fg = dark ? "FFFFFF" : C.ink;
  const sub = dark ? "B7C6DE" : C.slate;
  tx(s, eyebrow, {
    x: 0.55, y: 0.42, w: 12.2, h: 0.3,
    fontSize: 11, color: C.cyan, bold: true, charSpacing: 2.2,
  });
  tx(s, title, {
    x: 0.55, y: 0.74, w: 12.2, h: 0.62,
    fontSize: 28, color: fg, bold: true,
  });
  rect(s, {
    x: 0.58, y: 1.42, w: 1.9, h: 0.05,
    fill: { color: C.cyan }, line: { type: "none" },
  });
  if (subtitle) {
    tx(s, subtitle, {
      x: 0.55, y: 1.55, w: 12.2, h: 0.4,
      fontSize: 12.5, color: sub, italic: true,
    });
    return 2.05;
  }
  return 1.62;
}

// Bullet list — items: string | { t, b, sub, icon }
function bullets(s, items, { x, y, w, h, size = 11.5, gap = 7, color = C.slate }) {
  const paras = [];
  for (const it of items) {
    const i = typeof it === "string" ? { t: it } : it;
    paras.push({
      text: i.t,
      options: {
        bullet: { code: "2022", indent: 9 },
        breakLine: true,
        bold: !!i.b,
        color: i.b ? C.ink : color,
        fontSize: i.sub ? size - 1.5 : size,
        fontFace: FONT,
        paraSpaceAfter: gap,
      },
    });
    if (i.sub) {
      paras.push({
        text: i.sub,
        options: {
          bullet: { code: "2013", indent: 22 },
          breakLine: true,
          color: C.muted,
          fontSize: size - 2,
          fontFace: FONT,
          paraSpaceAfter: gap,
        },
      });
    }
  }
  tx(s, paras, { x, y, w, h, valign: "top", lineSpacingMultiple: 1.04 });
}

function statTile(s, { x, y, w, h = 0.98, label, value, delta, tone = "ink", dark = false }) {
  const card = dark ? C.navySoft : C.card;
  const border = dark ? C.navySoft2 : C.line;
  const valColor =
    tone === "green" ? C.green :
    tone === "amber" ? C.amber :
    tone === "red" ? C.red :
    tone === "cyan" ? C.cyan :
    dark ? "FFFFFF" : C.ink;
  rrect(s, {
    x, y, w, h,
    fill: { color: card }, line: { color: border, width: 1 },
    rectRadius: 0.09,
    shadow: dark ? undefined : { type: "outer", color: "0B1B33", opacity: 0.05, blur: 5, offset: 2 },
  });
  tx(s, (label || "").toUpperCase(), {
    x: x + 0.16, y: y + 0.11, w: w - 0.32, h: 0.2,
    fontSize: 8.5, color: dark ? "8FA3C4" : C.muted, bold: true, charSpacing: 1,
  });
  tx(s, value, {
    x: x + 0.16, y: y + 0.32, w: w - 0.32, h: 0.4,
    fontSize: 17, color: valColor, bold: true,
  });
  if (delta) {
    tx(s, delta, {
      x: x + 0.16, y: y + h - 0.3, w: w - 0.32, h: 0.22,
      fontSize: 8.5, color: dark ? "B7C6DE" : C.muted,
    });
  }
}

function pill(s, { x, y, w, h = 0.3, text, fill = C.blueSoft, color = C.blue, size = 9, bold = true, dashed = false }) {
  rrect(s, {
    x, y, w, h,
    fill: { color: fill },
    line: dashed ? { color: C.muted, width: 1, dashType: "dash" } : { type: "none" },
    rectRadius: h / 2,
  });
  tx(s, text, {
    x, y, w, h, align: "center", valign: "middle",
    fontSize: size, color, bold, fontFace: FONT,
  });
}

function hbar(s, { x, y, w, label, pct, color, value }) {
  tx(s, label, { x, y, w: 1.5, h: 0.24, fontSize: 9.5, color: C.slate, valign: "middle" });
  rect(s, { x: x + 1.55, y: y + 0.045, w, h: 0.15, fill: { color: C.line }, line: { type: "none" } });
  rect(s, { x: x + 1.55, y: y + 0.045, w: (w * pct) / 100, h: 0.15, fill: { color }, line: { type: "none" } });
  if (value) {
    tx(s, value, { x: x + 1.55 + w + 0.12, y, w: 1.5, h: 0.24, fontSize: 9.5, color: C.ink, bold: true, valign: "middle" });
  }
}

function mockTable(s, { x, y, w, colW, headers, rows, rowH = 0.34, headFill = C.blueSoft, headColor = C.blue }) {
  const trows = [
    headers.map((hd) => ({
      text: hd,
      options: { bold: true, color: headColor, fontSize: 9, fontFace: FONT, fill: { color: headFill }, align: "left" },
    })),
    ...rows.map((r) =>
      r.map((c) => ({
        text: String(c.t ?? ""),
        options: {
          bold: !!c.b,
          color: c.color || C.ink,
          fontSize: 9.5,
          fontFace: FONT,
          fill: { color: c.fill || C.card },
          align: c.align || "left",
        },
      }))
    ),
  ];
  s.addTable(trows, {
    x, y, w,
    colW,
    rowH: [0.32, ...rows.map(() => rowH)],
    border: { type: "solid", color: C.line, pt: 0.75 },
    valign: "middle",
    margin: { left: 0.08, right: 0.08, top: 0.02, bottom: 0.02 },
    autoPage: false,
  });
}

function chip(s, { x, y, w, h = 0.36, text, sub, fill = C.card, border = C.line, color = C.ink, size = 9.5 }) {
  rrect(s, {
    x, y, w, h,
    fill: { color: fill }, line: { color: border, width: 1 }, rectRadius: 0.07,
  });
  tx(s, text, { x: x + 0.12, y, w: w - 0.24, h, fontSize: size, color, bold: true, valign: "middle" });
  if (sub) {
    tx(s, sub, {
      x: x + 0.12, y: y + h - 0.24, w: w - 0.24, h: 0.2,
      fontSize: 8, color: C.muted, valign: "middle",
    });
  }
}

// ════════════════════════════════════════════════════════════════
// SLIDE 1 — TITLE (dark)
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 1, { dark: true });
  tx(s, "RECEIVABLES FACTORING & MONITORING PLATFORM", {
    x: 0.85, y: 1.0, w: 11.6, h: 0.34,
    fontSize: 13, color: C.cyan, bold: true, charSpacing: 3,
  });
  tx(s, "Adventra", {
    x: 0.82, y: 1.38, w: 11.6, h: 1.5,
    fontSize: 72, color: "FFFFFF", bold: true,
  });
  tx(s, "Turn outstanding invoices into working capital — without losing sight of risk.", {
    x: 0.85, y: 2.95, w: 10.6, h: 0.9,
    fontSize: 21, color: "B7C6DE",
  });
  tx(s, "Institutional-grade invoice factoring combined with real-time debtor monitoring. Submit, advance, collect — while aging, concentration, and credit risk move live.", {
    x: 0.85, y: 3.7, w: 10.2, h: 0.9,
    fontSize: 12.5, color: "8FA3C4",
  });
  pill(s, {
    x: 0.85, y: 4.72, w: 2.7, h: 0.34,
    text: "v2.4 · Live receivables monitoring",
    fill: C.navySoft, color: C.cyan, size: 9.5,
  });
  // Stat strip
  const stats = [
    { v: "₹2.4B", l: "advanced in 2025" },
    { v: "11 hrs", l: "median time to fund" },
    { v: "0.42%", l: "loss rate, trailing 12mo" },
    { v: "98.7%", l: "collection rate" },
  ];
  const sw = (W - 1.7 - 3 * 0.22) / 4;
  stats.forEach((st, i) => {
    const x = 0.85 + i * (sw + 0.22);
    rrect(s, {
      x, y: 5.45, w: sw, h: 1.15,
      fill: { color: C.navySoft }, line: { color: C.navySoft2, width: 1 }, rectRadius: 0.1,
    });
    tx(s, st.v, { x: x + 0.2, y: 5.62, w: sw - 0.4, h: 0.42, fontSize: 21, color: "FFFFFF", bold: true });
    tx(s, st.l.toUpperCase(), {
      x: x + 0.2, y: 6.1, w: sw - 0.4, h: 0.3,
      fontSize: 8, color: "8FA3C4", charSpacing: 1, bold: true,
    });
  });
  s.addNotes(
    "Title slide. Adventra combines invoice factoring with institutional-grade debtor monitoring. The stat strip is the platform's own landing-page hero: ₹2.4B advanced in 2025, 11 hours median time to fund, 0.42% trailing loss rate, 98.7% collection rate."
  );
}

// ════════════════════════════════════════════════════════════════
// SLIDE 2 — GETTING IN
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 2);
  const y0 = header(s, {
    eyebrow: "GETTING IN",
    title: "One platform, six job-specific consoles",
    subtitle: "Landing page · Sign-in / Sign-up · Role-based navigation",
  });
  bullets(s, [
    "Landing page showcases six capabilities: advance ledger, aging & DSO, debtor credit, real-time alerts, same-day funding, portfolio analytics.",
    { t: "One account, six consoles — each role gets its own sidebar and permissions:", b: true },
    "Cmd+K / Ctrl+K command palette searches every page instantly.",
    "Role walls: each console only sees the pages relevant to its job.",
  ], { x: 0.55, y: y0 + 0.1, w: 6.3, h: 3.4 });
  // Right visual: login → consoles funnel
  rrect(s, {
    x: 8.1, y: y0 - 0.05, w: 4.6, h: 4.9,
    fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1,
    shadow: { type: "outer", color: "0B1B33", opacity: 0.06, blur: 6, offset: 2 },
  });
  tx(s, "SIGN IN / CREATE ACCOUNT", {
    x: 8.35, y: y0 + 0.12, w: 4.1, h: 0.3, align: "center",
    fontSize: 10, color: C.blue, bold: true, charSpacing: 1.4,
  });
  rrect(s, { x: 9.2, y: y0 + 0.5, w: 2.4, h: 0.42, fill: { color: C.blueSoft }, line: { type: "none" }, rectRadius: 0.08 });
  tx(s, "Open a free account", { x: 9.2, y: y0 + 0.5, w: 2.4, h: 0.42, align: "center", valign: "middle", fontSize: 10, color: C.blue, bold: true });
  arrow(s, "down", { x: 10.28, y: y0 + 0.98, w: 0.26, h: 0.3, fill: { color: C.cyan }, line: { type: "none" } });
  const consoles = [
    ["Factor console", "Admin"],
    ["Treasury desk", "Funding"],
    ["Checker desk", "Approvals"],
    ["Operations desk", "Transactions"],
    ["Sales workspace", "Leads & CRM"],
    ["Reporting console", "Reports"],
  ];
  const cw = 2.05, ch = 0.52;
  consoles.forEach((c, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 8.4 + col * (cw + 0.14);
    const y = y0 + 1.42 + row * (ch + 0.18);
    rrect(s, {
      x, y, w: cw, h: ch,
      fill: { color: i % 2 ? C.blueSoft : C.cyanSoft }, line: { color: C.line, width: 1 }, rectRadius: 0.08,
    });
    tx(s, c[0], { x: x + 0.12, y: y + 0.05, w: cw - 0.24, h: 0.24, fontSize: 10, color: C.ink, bold: true });
    tx(s, c[1], { x: x + 0.12, y: y + 0.27, w: cw - 0.24, h: 0.2, fontSize: 8, color: C.muted });
  });
  rrect(s, {
    x: 8.4, y: y0 + 4.16, w: 4.0, h: 0.44,
    fill: { color: C.bg }, line: { color: C.line, width: 1 }, rectRadius: 0.08,
  });
  tx(s, "⌘K  Quick navigate…  (search every page)", {
    x: 8.4, y: y0 + 4.16, w: 4.0, h: 0.44, align: "center", valign: "middle",
    fontSize: 9.5, color: C.slate,
  });
  s.addNotes("Walk through the landing page capabilities and the auth page (sign in / create account, no card required). Highlight that the same account produces six different consoles depending on role, and that Cmd+K searches every page.");
}

// ════════════════════════════════════════════════════════════════
// SLIDE 3 — DASHBOARD
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 3);
  const y0 = header(s, {
    eyebrow: "THE COMMAND CENTER",
    title: "Every number that matters, on one screen",
    subtitle: "Dashboard (/app/dashboard) — role-aware KPIs, trends, aging and alerts",
  });
  const tiles = [
    { l: "Sales (gross)", v: "₹1.24M", d: "312 invoices" },
    { l: "Cost of goods", v: "₹892K", d: "246 supplier invoices" },
    { l: "Gross income", v: "₹348K", d: "28.1% margin", tone: "green" },
    { l: "Net income", v: "₹271K", d: "after ₹77K expenses", tone: "green" },
    { l: "Outstanding (AR)", v: "₹486K", d: "128 open invoices" },
    { l: "Advanced", v: "₹312K", d: "across funded invoices", tone: "cyan" },
    { l: "Overdue", v: "14", d: "action required", tone: "red" },
    { l: "Collection rate", v: "96%", d: "lifetime", tone: "green" },
  ];
  const tw = 4.6, th = 1.05;
  tiles.forEach((t, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    statTile(s, {
      x: 0.55 + col * (tw + 0.25), y: y0 + row * (th + 0.13), w: tw, h: th,
      label: t.l, value: t.v, delta: t.d, tone: t.tone,
    });
  });
  // Right: aging waterfall + alerts
  rrect(s, {
    x: 10.0, y: y0, w: 2.8, h: 2.9,
    fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1,
  });
  tx(s, "Aging waterfall", { x: 10.16, y: y0 + 0.14, w: 2.5, h: 0.3, fontSize: 11.5, color: C.ink, bold: true });
  const aging = [
    ["Current", 62, "₹8.42M", C.green],
    ["1–30 days", 22, "₹2.98M", C.blue],
    ["31–60 days", 10, "₹1.36M", C.amber],
    ["61–90 days", 4, "₹540K", C.amber],
    ["90+ days", 2, "₹272K", C.red],
  ];
  aging.forEach((a, i) => {
    hbar(s, { x: 10.16, y: y0 + 0.56 + i * 0.46, w: 1.6, label: a[0], pct: a[1], color: a[3], value: a[2] });
  });
  rrect(s, {
    x: 10.0, y: y0 + 3.06, w: 2.8, h: 1.95,
    fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1,
  });
  tx(s, "Alerts", { x: 10.16, y: y0 + 3.28, w: 2.5, h: 0.3, fontSize: 11.5, color: C.ink, bold: true });
  [
    ["critical", "Apex Holdings — credit limit at 94%"],
    ["warning", "Invoice #INV-30421 overdue 47 days"],
    ["info", "Vega Logistics payment received — ₹128K"],
  ].forEach((a, i) => {
    ellipse(s, {
      x: 10.16, y: y0 + 3.5 + i * 0.45, w: 0.14, h: 0.14,
      fill: { color: a[0] === "critical" ? C.red : a[0] === "warning" ? C.amber : C.blue }, line: { type: "none" },
    });
    tx(s, a[1], {
      x: 10.4, y: y0 + 3.4 + i * 0.45, w: 2.3, h: 0.34,
      fontSize: 8.5, color: C.slate, valign: "middle",
    });
  });
  s.addNotes("Dashboard is the command center: income KPIs, funding KPIs (outstanding AR, advanced, overdue, collection rate), settlement quality (short payments, late days), gross vs net income trend, aging waterfall, alerts feed, recent invoices and expenses. Role-aware — factor console vs funding overview for treasury.");
}

// ════════════════════════════════════════════════════════════════
// SLIDE 4 — SALES & INVOICING
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 4);
  const y0 = header(s, {
    eyebrow: "SALES & INVOICING",
    title: "From sales invoice to funded asset",
    subtitle: "Sales invoices · Proforma invoices · Credit & debit notes (+ document preview pages)",
  });
  const cw = 3.95;
  // Card 1 — Sales invoices
  rrect(s, { x: 0.55, y: y0 + 0.05, w: cw, h: 4.35, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1, shadow: { type: "outer", color: "0B1B33", opacity: 0.05, blur: 5, offset: 2 } });
  tx(s, "Sales invoices", { x: 0.75, y: y0 + 0.2, w: 3.5, h: 0.32, fontSize: 13.5, color: C.ink, bold: true });
  bullets(s, [
    "Submit invoices into the queue.",
    "Each routes to the Checker desk for approval before funding.",
    "Live statuses: paid, overdue, advanced, rejected.",
    "Branded PDF preview & print pages.",
  ], { x: 0.75, y: y0 + 0.62, w: 3.55, h: 2.2, size: 10.5 });
  tx(s, "STATUSES", { x: 0.75, y: y0 + 3.05, w: 3.5, h: 0.2, fontSize: 8, color: C.muted, bold: true, charSpacing: 1.2 });
  const statuses = [["Paid", C.green, C.greenSoft], ["Overdue", C.red, C.redSoft], ["Advanced", C.blue, C.blueSoft], ["Rejected", C.amber, C.amberSoft]];
  statuses.forEach((st, i) => {
    pill(s, { x: 0.75 + i * 0.92, y: y0 + 3.32, w: 0.84, h: 0.3, text: st[0], fill: st[2], color: st[1], size: 8 });
  });
  // Card 2 — Proformas
  rrect(s, { x: 0.55 + cw + 0.25, y: y0 + 0.05, w: cw, h: 4.35, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1, shadow: { type: "outer", color: "0B1B33", opacity: 0.05, blur: 5, offset: 2 } });
  tx(s, "Proforma invoices", { x: 0.75 + cw + 0.25, y: y0 + 0.2, w: 3.5, h: 0.32, fontSize: 13.5, color: C.ink, bold: true });
  bullets(s, [
    "Raise a proforma against a PO number.",
    "Take or release an advance on the spot.",
    "Advance is applied to the final invoice sharing the same PO.",
  ], { x: 0.75 + cw + 0.25, y: y0 + 0.62, w: 3.55, h: 2.2, size: 10.5 });
  tx(s, "PROFORMA → ADVANCE FLOW", { x: 0.75 + cw + 0.25, y: y0 + 2.95, w: 3.5, h: 0.2, fontSize: 8, color: C.muted, bold: true, charSpacing: 1.2 });
  const pf = [["PO #2201", C.blue, C.blueSoft], ["Advance", C.cyan, C.cyanSoft], ["Final invoice", C.green, C.greenSoft]];
  pf.forEach((st, i) => {
    pill(s, { x: 0.75 + cw + 0.25 + i * 1.24, y: y0 + 3.25, w: 1.12, h: 0.34, text: st[0], fill: st[2], color: st[1], size: 8.5 });
    if (i < 2) tx(s, "→", { x: 0.75 + cw + 0.25 + i * 1.24 + 1.06, y: y0 + 3.22, w: 0.24, h: 0.34, fontSize: 12, color: C.muted, align: "center" });
  });
  // Card 3 — Notes
  rrect(s, { x: 0.55 + (cw + 0.25) * 2, y: y0 + 0.05, w: cw, h: 4.35, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1, shadow: { type: "outer", color: "0B1B33", opacity: 0.05, blur: 5, offset: 2 } });
  tx(s, "Credit & debit notes", { x: 0.75 + (cw + 0.25) * 2, y: y0 + 0.2, w: 3.5, h: 0.32, fontSize: 13.5, color: C.ink, bold: true });
  bullets(s, [
    "Credit notes: refunds & discounts.",
    "Debit notes: extra charges & claims.",
    "Every note flows through approval and treasury before adjusting the linked invoice.",
  ], { x: 0.75 + (cw + 0.25) * 2, y: y0 + 0.62, w: 3.55, h: 2.2, size: 10.5 });
  tx(s, "APPROVAL PIPELINE", { x: 0.75 + (cw + 0.25) * 2, y: y0 + 2.95, w: 3.5, h: 0.2, fontSize: 8, color: C.muted, bold: true, charSpacing: 1.2 });
  const np = [["Checker", C.amber, C.amberSoft], ["Funding queue", C.blue, C.blueSoft], ["Treasury applies", C.green, C.greenSoft]];
  np.forEach((st, i) => {
    pill(s, { x: 0.75 + (cw + 0.25) * 2 + i * 1.27, y: y0 + 3.25, w: 1.15, h: 0.34, text: st[0], fill: st[2], color: st[1], size: 8.5 });
    if (i < 2) tx(s, "→", { x: 0.75 + (cw + 0.25) * 2 + i * 1.27 + 1.09, y: y0 + 3.22, w: 0.24, h: 0.34, fontSize: 12, color: C.muted, align: "center" });
  });
  s.addNotes("Cover the invoice queue lifecycle (submit → checker → funding), proformas (PO-linked advances), credit/debit notes, and the branded invoice/note preview pages. Core control story: approvals always gate funding.");
}

// ════════════════════════════════════════════════════════════════
// SLIDE 5 — PROCUREMENT & COSTS
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 5);
  const y0 = header(s, {
    eyebrow: "PROCUREMENT & COSTS",
    title: "Know every dollar in and every dollar out",
    subtitle: "Purchase invoices · Vendors · Expenses · Advances",
  });
  const cards = [
    { t: "Purchase invoices", desc: "Supplier invoices with PO details, linked to the sales they support — the cost side of each deal.", fill: C.blueSoft, icon: "PI" },
    { t: "Vendors", desc: "The companies you buy from — contacts, payment terms, and open payables.", fill: C.cyanSoft, icon: "VE" },
    { t: "Expenses", desc: "Logistics, insurance, interest and other operating costs — linked to invoices for true per-deal economics, with document attachments.", fill: C.amberSoft, icon: "EX" },
    { t: "Advances", desc: "Money received from customers or paid to suppliers ahead of the final invoice — every advance is tied to a specific invoice.", fill: C.greenSoft, icon: "AD" },
  ];
  const cw = 6.0, chh = 1.92;
  cards.forEach((c, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 0.55 + col * (cw + 0.25);
    const y = y0 + row * (chh + 0.25);
    rrect(s, { x, y, w: cw, h: chh, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1, shadow: { type: "outer", color: "0B1B33", opacity: 0.05, blur: 5, offset: 2 } });
    rrect(s, { x: x + 0.2, y: y + 0.2, w: 0.5, h: 0.5, fill: { color: c.fill }, line: { type: "none" }, rectRadius: 0.08 });
    tx(s, c.icon, { x: x + 0.2, y: y + 0.2, w: 0.5, h: 0.5, align: "center", valign: "middle", fontSize: 9, color: C.ink, bold: true });
    tx(s, c.t, { x: x + 0.85, y: y + 0.24, w: 4.9, h: 0.32, fontSize: 14, color: C.ink, bold: true });
    tx(s, c.desc, { x: x + 0.2, y: y + 0.86, w: cw - 0.4, h: 0.72, fontSize: 10.5, color: C.slate, valign: "top", lineSpacingMultiple: 1.05 });
    if (c.t === "Expenses") {
      pill(s, { x: x + 0.2, y: y + chh - 0.46, w: 1.85, h: 0.3, text: "Linked to INV-2041", fill: C.cyanSoft, color: C.blue, size: 8 });
    }
    if (c.t === "Advances") {
      pill(s, { x: x + 0.2, y: y + chh - 0.46, w: 2.0, h: 0.3, text: "Tied to PO #2201", fill: C.greenSoft, color: C.green, size: 8 });
    }
  });
  s.addNotes("Procurement & costs: purchase invoices with PO links, vendor management, expenses linked to deals (logistics/insurance/interest) with document attachments, and advances tied to specific invoices (customer receipts or supplier payments ahead of final invoice).");
}

// ════════════════════════════════════════════════════════════════
// SLIDE 6 — COUNTERPARTIES & CREDIT RISK
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 6);
  const y0 = header(s, {
    eyebrow: "SALES & CREDIT",
    title: "Score, limit, and concentration in a single view",
    subtitle: "Debtor book · Suppliers · CRM / Salesforce",
  });
  // Left: debtor exposure vs limits
  rrect(s, { x: 0.55, y: y0 + 0.05, w: 5.6, h: 4.4, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "Debtor exposure vs credit limits", { x: 0.75, y: y0 + 0.2, w: 5.2, h: 0.3, fontSize: 12, color: C.ink, bold: true });
  const debtors = [
    ["Apex Holdings", 94, 100],
    ["Northwind", 62, 80],
    ["Vega Logistics", 45, 50],
    ["Bluepeak Retail", 30, 60],
    ["Summit Foods", 22, 40],
  ];
  debtors.forEach((d, i) => {
    const y = y0 + 0.68 + i * 0.72;
    tx(s, d[0], { x: 0.75, y, w: 1.7, h: 0.24, fontSize: 9.5, color: C.slate, valign: "middle" });
    rect(s, { x: 2.5, y: y + 0.035, w: 2.6, h: 0.16, fill: { color: C.line }, line: { type: "none" } });
    rect(s, { x: 2.5, y: y + 0.035, w: 2.6 * (d[1] / 100), h: 0.16, fill: { color: d[1] >= 90 ? C.red : C.cyan }, line: { type: "none" } });
    rect(s, { x: 2.5 + 2.6 * (d[2] / 100) - 0.015, y: y - 0.02, w: 0.03, h: 0.27, fill: { color: C.muted }, line: { type: "none" } });
    tx(s, d[1] + "%", { x: 5.2, y, w: 0.8, h: 0.24, fontSize: 9.5, color: C.ink, bold: true, valign: "middle" });
  });
  tx(s, "▍bar = limit", { x: 2.5, y: y0 + 4.02, w: 3, h: 0.2, fontSize: 7.5, color: C.muted });
  // Middle: risk score card
  rrect(s, { x: 6.4, y: y0 + 0.05, w: 2.9, h: 4.4, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "Debtor risk score", { x: 6.6, y: y0 + 0.2, w: 2.5, h: 0.3, fontSize: 12, color: C.ink, bold: true });
  tx(s, "78 / 100", { x: 6.6, y: y0 + 0.72, w: 2.5, h: 0.55, fontSize: 24, color: C.blue, bold: true, align: "center" });
  rect(s, { x: 6.7, y: y0 + 1.42, w: 2.3, h: 0.18, fill: { color: C.line }, line: { type: "none" } });
  rect(s, { x: 6.7, y: y0 + 1.42, w: 2.3 * 0.78, h: 0.18, fill: { color: C.blue }, line: { type: "none" } });
  pill(s, { x: 6.75, y: y0 + 1.85, w: 2.2, h: 0.34, text: "Risk grade B+ · Limit ₹250K", fill: C.greenSoft, color: C.green, size: 9 });
  tx(s, "Trip a credit limit and you'll know before the wire moves — alerts fire immediately.", { x: 6.6, y: y0 + 2.5, w: 2.5, h: 1.2, fontSize: 10, color: C.slate, italic: true });
  // Right: CRM pipeline
  rrect(s, { x: 9.55, y: y0 + 0.05, w: 3.2, h: 4.4, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "CRM pipeline", { x: 9.75, y: y0 + 0.2, w: 2.8, h: 0.3, fontSize: 12, color: C.ink, bold: true });
  const pipe = [["New", "214", C.blueSoft, C.blue], ["Contacted", "98", C.cyanSoft, C.cyan], ["Qualified", "41", C.amberSoft, C.amber], ["Won", "17", C.greenSoft, C.green]];
  pipe.forEach((p, i) => {
    const y = y0 + 0.72 + i * 0.82;
    const wd = 2.8 * (0.55 + 0.15 * i);
    rrect(s, { x: 9.75, y, w: wd, h: 0.5, fill: { color: p[2] }, line: { color: C.line, width: 1 }, rectRadius: 0.08 });
    tx(s, p[0], { x: 9.9, y, w: 1.4, h: 0.5, valign: "middle", fontSize: 10, color: C.ink, bold: true });
    tx(s, p[1], { x: 9.75 + wd - 0.6, y, w: 0.5, h: 0.5, valign: "middle", align: "right", fontSize: 10, color: p[3], bold: true });
  });
  s.addNotes("Counterparties: debtor book with credit limits, risk scores and live exposure; supplier onboarding with credit lines and lifecycle; CRM leads/opportunities/activities. The limit-trip alert is the platform's differentiator.");
}

// ════════════════════════════════════════════════════════════════
// SLIDE 7 — APPROVAL, FUNDING & TEAM WORKFLOW
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 7);
  const y0 = header(s, {
    eyebrow: "CONTROL & WORKFLOW",
    title: "Maker–checker control with same-day funding",
    subtitle: "Checker desk · Funding queue · My Workspace · My Reports · Team requests",
  });
  // Left: workspace mock
  rrect(s, { x: 0.55, y: y0 + 0.05, w: 3.7, h: 4.4, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "My Workspace — submit & track", { x: 0.75, y: y0 + 0.2, w: 3.3, h: 0.3, fontSize: 12, color: C.ink, bold: true });
  const tabs = ["Visits", "Travel", "Expenses", "Leave"];
  tabs.forEach((t, i) => {
    rrect(s, { x: 0.75 + i * 0.86, y: y0 + 0.62, w: 0.78, h: 0.34, fill: { color: i === 0 ? C.blueSoft : C.bg }, line: { color: C.line, width: 1 }, rectRadius: 0.06 });
    tx(s, t, { x: 0.75 + i * 0.86, y: y0 + 0.62, w: 0.78, h: 0.34, align: "center", valign: "middle", fontSize: 8.5, color: i === 0 ? C.blue : C.slate, bold: i === 0 });
  });
  [
    ["Pending", "Site visit — Apex Holdings", "02 Aug"],
    ["Approved", "Travel — Nairobi route", "29 Jul"],
    ["Rejected", "Leave — 12–14 Aug", "27 Jul"],
  ].forEach((r, i) => {
    const y = y0 + 1.24 + i * 0.94;
    rrect(s, { x: 0.75, y, w: 3.3, h: 0.82, fill: { color: C.bg }, line: { color: C.line, width: 1 }, rectRadius: 0.08 });
    const col = r[0] === "Pending" ? C.amber : r[0] === "Approved" ? C.green : C.red;
    const soft = r[0] === "Pending" ? C.amberSoft : r[0] === "Approved" ? C.greenSoft : C.redSoft;
    pill(s, { x: 0.9, y: y + 0.1, w: 0.82, h: 0.26, text: r[0], fill: soft, color: col, size: 7.5 });
    tx(s, r[1], { x: 0.9, y: y + 0.42, w: 2.4, h: 0.3, fontSize: 9, color: C.ink, bold: true });
    tx(s, r[2], { x: 2.85, y: y + 0.44, w: 1.1, h: 0.24, fontSize: 8, color: C.muted, align: "right" });
  });
  // Center: workflow
  const wf = [
    { t: "Submit", d: "Invoice / advance / note", c: C.blue, f: C.blueSoft },
    { t: "Checker desk", d: "Maker–checker review · approve or reject", c: C.amber, f: C.amberSoft },
    { t: "Funding queue", d: "Treasury disburses · releases reserves on collection", c: C.green, f: C.greenSoft },
  ];
  wf.forEach((w2, i) => {
    const x = 4.45 + i * 1.85;
    rrect(s, { x, y: y0 + 0.7, w: 1.55, h: 1.35, fill: { color: w2.f }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
    tx(s, w2.t, { x: x + 0.12, y: y0 + 0.82, w: 1.31, h: 0.4, fontSize: 11, color: C.ink, bold: true });
    tx(s, w2.d, { x: x + 0.12, y: y0 + 1.26, w: 1.31, h: 0.7, fontSize: 8, color: C.slate, lineSpacingMultiple: 1.02 });
    if (i < 2) arrow(s, "right", { x: x + 1.57, y: y0 + 1.2, w: 0.26, h: 0.26, fill: { color: C.cyan }, line: { type: "none" } });
  });
  tx(s, "Every submitted transaction is reviewed by a second set of eyes before a single dollar moves.", {
    x: 4.3, y: y0 + 2.35, w: 5.5, h: 0.6, fontSize: 10, color: C.slate, italic: true, align: "center",
  });
  // Right: reporting manager
  rrect(s, { x: 9.9, y: y0 + 0.05, w: 2.9, h: 4.4, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "Reporting manager", { x: 10.05, y: y0 + 0.2, w: 2.6, h: 0.3, fontSize: 12, color: C.ink, bold: true });
  [
    ["8 team members", "My Reports"],
    ["14 pending", "Team requests"],
    ["View-as", "Inspect any member's metrics"],
  ].forEach((r, i) => {
    const y = y0 + 0.7 + i * 0.72;
    chip(s, { x: 10.05, y, w: 2.6, h: 0.6, text: r[0], sub: r[1], fill: C.bg, border: C.line, size: 10 });
  });
  tx(s, "View-as lets a manager open any team member's workspace with their exact metrics.", {
    x: 10.05, y: y0 + 3.1, w: 2.6, h: 0.9, fontSize: 9, color: C.muted, italic: true,
  });
  s.addNotes("The control spine: submit → checker (maker–checker review) → funding queue (treasury disburses, releases reserves on collection). Workspace covers Visits/Travel/Expenses/Leave submissions. Reporting managers get My Reports, Team requests, and view-as progress inspection.");
}

// ════════════════════════════════════════════════════════════════
// SLIDE 8 — PRODUCT CATALOG & SKUs (showcase)
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 8);
  const y0 = header(s, {
    eyebrow: "CATALOG ★ SHOWCASE",
    title: "One master catalog that powers the whole operation",
    subtitle: "Products & SKUs (/app/products) — the single source of truth behind forecasting, low-stock alerts, and inventory valuation",
  });
  const tiles = [
    { l: "SKUs", v: "2,480" },
    { l: "Active", v: "2,106", tone: "green" },
    { l: "Low stock", v: "342", tone: "amber" },
    { l: "Out of stock", v: "32", tone: "red" },
    { l: "Inventory value", v: "₹4.8M", tone: "cyan" },
  ];
  const tw = (12.23 - 4 * 0.22) / 5;
  tiles.forEach((t, i) => {
    statTile(s, { x: 0.55 + i * (tw + 0.22), y: y0, w: tw, h: 1.0, label: t.l, value: t.v, tone: t.tone });
  });
  // Product table
  mockTable(s, {
    x: 0.55, y: y0 + 1.22, w: 12.23,
    colW: [1.35, 2.9, 1.9, 0.95, 0.95, 1.15, 1.15, 1.88],
    headers: ["SKU", "Product", "Attrs", "Price", "Cost", "On hand", "Reorder @", "Status"],
    rows: [
      [
        { t: "TB-1001", b: true, color: C.blue }, { t: "Trekking Backpack", b: true }, { t: "Backpacks · M · navy · all", color: C.muted },
        { t: "₹59.99", align: "right" }, { t: "₹25.00", align: "right", color: C.muted },
        { t: "30", align: "right", color: C.amber, b: true }, { t: "40", align: "right", color: C.muted },
        { t: "LOW", align: "center", b: true, color: C.amber, fill: C.amberSoft },
      ],
      [
        { t: "RT-2204", b: true, color: C.blue }, { t: "Running Shoes", b: true }, { t: "Footwear · 42 · black", color: C.muted },
        { t: "₹129.00", align: "right" }, { t: "₹61.00", align: "right", color: C.muted },
        { t: "4", align: "right", color: C.red, b: true }, { t: "50", align: "right", color: C.muted },
        { t: "OUT", align: "center", b: true, color: C.red, fill: C.redSoft },
      ],
      [
        { t: "HL-3301", b: true, color: C.blue }, { t: "Hiking Boots", b: true }, { t: "Footwear · 43 · brown", color: C.muted },
        { t: "₹149.00", align: "right" }, { t: "₹70.00", align: "right", color: C.muted },
        { t: "86", align: "right", color: C.green, b: true }, { t: "30", align: "right", color: C.muted },
        { t: "OK", align: "center", b: true, color: C.green, fill: C.greenSoft },
      ],
      [
        { t: "NP-4412", b: true, color: C.blue }, { t: "Nutrition Pack", b: true }, { t: "Nutrition · —", color: C.muted },
        { t: "₹24.50", align: "right" }, { t: "₹11.00", align: "right", color: C.muted },
        { t: "210", align: "right", color: C.green, b: true }, { t: "60", align: "right", color: C.muted },
        { t: "OK", align: "center", b: true, color: C.green, fill: C.greenSoft },
      ],
    ],
  });
  tx(s, "Rich attributes: category (Footwear · Apparel · Accessories · Equipment · Nutrition), subcategory, gender, size, color, season. Trading data: unit price, unit cost, reorder level, max stock, supplier lead time, lifecycle status. Live stock-on-hand is computed automatically from stock movements — no manual counting.", {
    x: 0.55, y: y0 + 3.4, w: 8.4, h: 1.2, fontSize: 10.5, color: C.slate, lineSpacingMultiple: 1.15,
  });
  rrect(s, { x: 9.15, y: y0 + 3.4, w: 3.6, h: 1.05, fill: { color: C.cyanSoft }, line: { color: C.cyan, width: 1 }, rectRadius: 0.1 });
  tx(s, "Reorder level", { x: 9.4, y: y0 + 3.55, w: 3.1, h: 0.3, fontSize: 10, color: C.blue, bold: true });
  tx(s, "powers the demand forecast & low-stock alerts", { x: 9.4, y: y0 + 3.85, w: 3.1, h: 0.45, fontSize: 9.5, color: C.slate, lineSpacingMultiple: 1.05 });
  tx(s, "Search by SKU / name / color · filter by category · full create–edit–delete flows", {
    x: 0.55, y: y0 + 4.55, w: 12.2, h: 0.3, fontSize: 9.5, color: C.muted,
  });
  s.addNotes("Showcase 1 — Product catalog. Master list of every SKU with rich attributes and trading data (price, cost, reorder level, max stock, lead time, status). Live stock-on-hand from movements, summary tiles (SKUs, active, low, out, inventory value), Out/Low/OK pills, search/filter, CRUD. Reorder levels feed the forecast and alerts.");
}

// ════════════════════════════════════════════════════════════════
// SLIDE 9 — INVENTORY / STOCK LEDGER (showcase)
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 9);
  const y0 = header(s, {
    eyebrow: "INVENTORY ★ SHOWCASE",
    title: "A double-entry stock ledger, not a spreadsheet",
    subtitle: "Inventory (/app/inventory) — every unit that moves is a dated, valued journal entry",
  });
  // Left: current balances
  rrect(s, { x: 0.55, y: y0 + 0.05, w: 6.0, h: 4.45, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "Current balances", { x: 0.75, y: y0 + 0.18, w: 5.6, h: 0.3, fontSize: 12, color: C.ink, bold: true });
  mockTable(s, {
    x: 0.75, y: y0 + 0.58, w: 5.6,
    colW: [2.5, 1.0, 0.7, 1.4],
    headers: ["Item", "On hand", "Unit", "Value"],
    rows: [
      [{ t: "Trekking Backpack", b: true }, { t: "214", align: "right", b: true }, { t: "unit" }, { t: "₹5,350", align: "right" }],
      [{ t: "Running Shoes", b: true }, { t: "104", align: "right", b: true }, { t: "pair" }, { t: "₹6,344", align: "right" }],
      [{ t: "Hiking Boots", b: true }, { t: "86", align: "right", b: true }, { t: "pair" }, { t: "₹6,020", align: "right" }],
      [{ t: "Fuel (ad-hoc)", b: true }, { t: "1,200", align: "right", b: true }, { t: "L" }, { t: "₹1,440", align: "right" }],
    ],
  });
  tx(s, "Smart valuation: stock-in at unit price · stock-out at unit cost. Not every transaction needs inventory — record ad-hoc items too.", {
    x: 0.75, y: y0 + 3.1, w: 5.6, h: 0.9, fontSize: 9.5, color: C.muted, lineSpacingMultiple: 1.12,
  });
  pill(s, { x: 0.75, y: y0 + 3.95, w: 1.95, h: 0.32, text: "Stock-in = price (credit)", fill: C.greenSoft, color: C.green, size: 8.5 });
  pill(s, { x: 2.85, y: y0 + 3.95, w: 2.05, h: 0.32, text: "Stock-out = cost (debit)", fill: C.amberSoft, color: C.amber, size: 8.5 });
  // Right: movements journal
  rrect(s, { x: 6.8, y: y0 + 0.05, w: 5.98, h: 4.45, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "Movement journal", { x: 7.0, y: y0 + 0.18, w: 5.5, h: 0.3, fontSize: 12, color: C.ink, bold: true });
  const moves = [
    { d: "03 Aug", dir: "in", item: "Trekking Backpack", qty: "+120", cost: "₹25.00", link: "PI-2201", col: C.green, soft: C.greenSoft },
    { d: "01 Aug", dir: "out", item: "Trekking Backpack", qty: "−90", cost: "₹25.00", link: "INV-3041", col: C.amber, soft: C.amberSoft },
    { d: "28 Jul", dir: "in", item: "Fuel (ad-hoc)", qty: "+1,200 L", cost: "—", link: "unlinked", col: C.green, soft: C.greenSoft },
    { d: "25 Jul", dir: "out", item: "Running Shoes", qty: "−12", cost: "₹61.00", link: "INV-3022", col: C.amber, soft: C.amberSoft },
  ];
  moves.forEach((m, i) => {
    const y = y0 + 0.62 + i * 0.78;
    rrect(s, { x: 7.0, y, w: 5.55, h: 0.7, fill: { color: C.bg }, line: { color: C.line, width: 1 }, rectRadius: 0.08 });
    tx(s, m.d, { x: 7.12, y: y + 0.06, w: 0.62, h: 0.2, fontSize: 7.5, color: C.muted });
    const dirLabel = m.dir === "in" ? "Credit · Stock-in ↓" : "Debit · Stock-out ↑";
    tx(s, dirLabel, { x: 7.12, y: y + 0.28, w: 1.35, h: 0.24, fontSize: 8.5, color: m.col, bold: true });
    tx(s, m.item, { x: 8.55, y: y + 0.06, w: 1.9, h: 0.22, fontSize: 9, color: C.ink, bold: true });
    tx(s, m.qty + " @ " + m.cost, { x: 8.55, y: y + 0.34, w: 1.9, h: 0.2, fontSize: 8, color: C.slate });
    pill(s, { x: 10.55, y: y + 0.18, w: 1.85, h: 0.3, text: "🔗 " + m.link, fill: m.soft, color: m.col, size: 8 });
  });
  // Bulk entry footer
  rrect(s, { x: 7.0, y: y0 + 3.85, w: 5.55, h: 0.5, fill: { color: C.bg }, line: { color: C.muted, width: 1, dashType: "dash" }, rectRadius: 0.08 });
  tx(s, "+ Add another entry — bulk mode records many dated movements with per-row qty, date & notes", {
    x: 7.12, y: y0 + 3.85, w: 5.3, h: 0.5, valign: "middle", fontSize: 8.5, color: C.slate, align: "center",
  });
  s.addNotes("Showcase 2 — Inventory stock ledger. Stock-in (credit) from purchase invoices, stock-out (debit) from sales invoices. Current balances per item with live value, full movement journal with linked invoices (drill to source), smart valuation (price in / cost out), bulk entry mode, filters and delete. Movements link to catalog products for forecasting or stay ad-hoc.");
}

// ════════════════════════════════════════════════════════════════
// SLIDE 10 — DEMAND FORECASTING & REORDER (showcase)
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 10);
  const y0 = header(s, {
    eyebrow: "INTELLIGENCE ★ SHOWCASE",
    title: "AI-grade demand forecasting — every SKU, every month",
    subtitle: "Demand forecast & reorder (/app/forecast) — seasonal weighted-trend model over 12 months, recomputed live",
  });
  const tiles = [
    { l: "Need reorder", v: "118", tone: "amber" },
    { l: "Critical", v: "9", tone: "red" },
    { l: "Out of stock", v: "32", tone: "red" },
    { l: "Fast movers", v: "214", tone: "green" },
    { l: "Slow movers", v: "96", tone: "amber" },
    { l: "Dead stock", v: "41", tone: "muted" },
  ];
  const tw = (12.23 - 5 * 0.22) / 6;
  tiles.forEach((t, i) => {
    statTile(s, { x: 0.55 + i * (tw + 0.22), y: y0, w: tw, h: 0.95, label: t.l, value: t.v, tone: t.tone });
  });
  // Left: forecast chart mock
  rrect(s, { x: 0.55, y: y0 + 1.15, w: 6.5, h: 3.4, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "TB-1001 · Trekking Backpack — monthly forecast", { x: 0.75, y: y0 + 1.3, w: 6.1, h: 0.3, fontSize: 11.5, color: C.ink, bold: true });
  // confidence band
  rrect(s, { x: 0.85, y: y0 + 1.85, w: 5.9, h: 1.35, fill: { color: C.blueSoft }, line: { type: "none" }, rectRadius: 0.05 });
  tx(s, "80% prediction interval", { x: 0.9, y: y0 + 1.9, w: 3, h: 0.22, fontSize: 7.5, color: C.blue, bold: true });
  const bars = [55, 70, 62, 80, 95, 88, 110, 124];
  const labels = ["Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
  const bw = 0.5;
  bars.forEach((v, i) => {
    const hh = (v / 124) * 1.0;
    const x = 0.95 + i * 0.72;
    const y = y0 + 3.05 - hh;
    rrect(s, { x, y, w: bw, h: hh, fill: { color: i === bars.length - 1 ? C.cyan : C.blue }, line: { type: "none" }, rectRadius: 0.04 });
    tx(s, labels[i], { x: x - 0.08, y: y0 + 3.1, w: 0.7, h: 0.2, fontSize: 7.5, color: C.muted, align: "center" });
  });
  line(s, { x: 0.85, y: y0 + 2.78, w: 5.9, h: 0, line: { color: C.red, width: 1.2, dashType: "dash" } });
  tx(s, "reorder trigger", { x: 4.6, y: y0 + 2.54, w: 1.6, h: 0.2, fontSize: 7.5, color: C.red, align: "right" });
  tx(s, "Model pipeline: stockout-corrected demand → exponentially weighted baseline → weighted trend → raw seasonal factors → business factors → 80% confidence intervals.", {
    x: 0.75, y: y0 + 3.45, w: 6.1, h: 0.8, fontSize: 8.5, color: C.muted, lineSpacingMultiple: 1.1,
  });
  // Right: SKU insight card
  rrect(s, { x: 7.3, y: y0 + 1.15, w: 5.5, h: 3.4, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "SKU insight", { x: 7.5, y: y0 + 1.3, w: 3, h: 0.3, fontSize: 11.5, color: C.ink, bold: true });
  pill(s, { x: 7.5, y: y0 + 1.68, w: 1.3, h: 0.32, text: "Fast mover", fill: C.greenSoft, color: C.green, size: 9 });
  pill(s, { x: 8.95, y: y0 + 1.68, w: 1.5, h: 0.32, text: "Accelerating", fill: C.blueSoft, color: C.blue, size: 9 });
  pill(s, { x: 10.6, y: y0 + 1.68, w: 1.5, h: 0.32, text: "CRITICAL", fill: C.redSoft, color: C.red, size: 9 });
  const rows = [
    ["Days of cover", "30"],
    ["Estimated stockout", "12 Aug"],
    ["Reorder by (last safe)", "29 Jul"],
    ["Next refill (order today)", "14 Aug"],
    ["Recommended reorder", "84 units · ₹2,100"],
    ["Pricing strategy", "Protect margin · review +3–5% (min ₹41.67)"],
  ];
  rows.forEach((r, i) => {
    const y = y0 + 2.18 + i * 0.36;
    tx(s, r[0], { x: 7.5, y, w: 2.2, h: 0.28, fontSize: 9, color: C.muted });
    tx(s, r[1], { x: 9.7, y, w: 3.0, h: 0.28, fontSize: 9, color: C.ink, bold: true, align: "right" });
  });
  tx(s, "Every number auditable: expand any SKU to see the full calculation breakdown — weights, trend R², seasonal factors, safety stock, lead-time demand.", {
    x: 7.5, y: y0 + 4.28, w: 5.1, h: 0.22, fontSize: 8, color: C.muted,
  });
  s.addNotes("Showcase 3 — Demand forecast & reorder. Seasonal weighted-trend model over 12 months: availability-corrected demand, exponentially weighted baseline, weighted trend, raw seasonal factors, business factors (trekking season, weather, promotion lift, regional, events), 80% confidence intervals. Reorder = lead-time demand + safety stock (95% service level) − stock, capped by max stock & MOQ. Timelines: stockout date, reorder-by, refill, urgency. Velocity (fast/medium/slow/dead by category), momentum, stockout/overstock risk, pricing strategy recommendations, full calculation breakdown. Live 60s refresh, daily snapshots, one-click recompute.");
}

// ════════════════════════════════════════════════════════════════
// SLIDE 11 — ACCOUNTING & FINANCIAL STATEMENTS
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 11);
  const y0 = header(s, {
    eyebrow: "FINANCIAL STATEMENTS",
    title: "Double-entry certainty behind every transaction",
    subtitle: "Accounting · Balance sheet · Reports · Requests · Profile · Settings",
  });
  // Left: journal entry mock
  rrect(s, { x: 0.55, y: y0 + 0.05, w: 5.9, h: 4.4, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "Journal · INV-3041 (balanced)", { x: 0.75, y: y0 + 0.18, w: 5.5, h: 0.3, fontSize: 12, color: C.ink, bold: true });
  tx(s, "Account", { x: 0.75, y: y0 + 0.62, w: 3.0, h: 0.26, fontSize: 8.5, color: C.muted, bold: true, charSpacing: 1 });
  tx(s, "Debit", { x: 3.6, y: y0 + 0.62, w: 1.2, h: 0.26, fontSize: 8.5, color: C.muted, bold: true, charSpacing: 1 });
  tx(s, "Credit", { x: 4.85, y: y0 + 0.62, w: 1.2, h: 0.26, fontSize: 8.5, color: C.muted, bold: true, charSpacing: 1 });
  line(s, { x: 0.75, y: y0 + 0.92, w: 5.3, h: 0, line: { color: C.line, width: 1 } });
  [
    ["Accounts receivable", "₹5,390", "", true],
    ["Revenue — sales", "", "₹5,390", false],
  ].forEach((r, i) => {
    const y = y0 + 1.0 + i * 0.4;
    tx(s, r[0], { x: 0.75, y, w: 2.8, h: 0.3, fontSize: 10, color: C.ink, bold: r[3] });
    tx(s, r[1], { x: 3.6, y, w: 1.2, h: 0.3, fontSize: 10, color: C.green, bold: true, align: "right" });
    tx(s, r[2], { x: 4.85, y, w: 1.2, h: 0.3, fontSize: 10, color: C.red, bold: true, align: "right" });
  });
  line(s, { x: 0.75, y: y0 + 1.85, w: 5.3, h: 0, line: { color: C.line, width: 1 } });
  tx(s, "Chart of accounts · manual journals · drill into every line", { x: 0.75, y: y0 + 2.0, w: 5.3, h: 0.5, fontSize: 9.5, color: C.muted });
  tx(s, "Every financial movement becomes a balanced journal entry — posted automatically from invoices, purchases, advances and expenses.", {
    x: 0.75, y: y0 + 2.6, w: 5.3, h: 1.1, fontSize: 10, color: C.slate, lineSpacingMultiple: 1.12,
  });
  // Right: balance sheet mock
  rrect(s, { x: 6.7, y: y0 + 0.05, w: 6.05, h: 4.4, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "Balance sheet — as of 31 Jul", { x: 6.9, y: y0 + 0.18, w: 5.6, h: 0.3, fontSize: 12, color: C.ink, bold: true });
  tx(s, "Assets", { x: 6.9, y: y0 + 0.6, w: 2.6, h: 0.26, fontSize: 9, color: C.blue, bold: true });
  tx(s, "Liabilities & Equity", { x: 9.9, y: y0 + 0.6, w: 2.6, h: 0.26, fontSize: 9, color: C.blue, bold: true });
  [
    ["Accounts receivable", "₹486K"],
    ["Inventory", "₹340K"],
    ["Cash & bank", "₹594K"],
  ].forEach((r, i) => {
    const y = y0 + 0.94 + i * 0.4;
    tx(s, r[0], { x: 6.9, y, w: 2.5, h: 0.3, fontSize: 9.5, color: C.slate });
    tx(s, r[1], { x: 9.3, y, w: 1.3, h: 0.3, fontSize: 9.5, color: C.ink, bold: true, align: "right" });
  });
  [
    ["Advances received", "₹312K"],
    ["Equity", "₹1.11M"],
  ].forEach((r, i) => {
    const y = y0 + 0.94 + i * 0.4;
    tx(s, r[0], { x: 9.9, y, w: 2.6, h: 0.3, fontSize: 9.5, color: C.slate });
    tx(s, r[1], { x: 11.55, y, w: 1.15, h: 0.3, fontSize: 9.5, color: C.ink, bold: true, align: "right" });
  });
  line(s, { x: 6.9, y: y0 + 2.25, w: 5.65, h: 0, line: { color: C.line, width: 1 } });
  tx(s, "Total assets", { x: 6.9, y: y0 + 2.32, w: 2.4, h: 0.3, fontSize: 10, color: C.ink, bold: true });
  tx(s, "₹1.42M", { x: 9.3, y: y0 + 2.32, w: 1.3, h: 0.3, fontSize: 10, color: C.blue, bold: true, align: "right" });
  tx(s, "₹1.42M", { x: 11.55, y: y0 + 2.32, w: 1.15, h: 0.3, fontSize: 10, color: C.blue, bold: true, align: "right" });
  tx(s, "Auto-updates from invoices, purchases, inventory, advances, accounts and manual entries. Profile & Settings manage personal info, photo, and company profile.", {
    x: 6.9, y: y0 + 2.85, w: 5.6, h: 1.1, fontSize: 9.5, color: C.muted, lineSpacingMultiple: 1.12,
  });
  s.addNotes("Accounting: chart of accounts, manual journals, drill into every line — double-entry certainty. Balance sheet auto-updates from invoices, purchases, inventory, advances, accounts, and manual entries. Reports & requests keep reporting managers in sync; Profile and Settings manage personal info, photo, and company profile.");
}

// ════════════════════════════════════════════════════════════════
// SLIDE 12 — MONITORING, OPERATIONS & ADMINISTRATION
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 12);
  const y0 = header(s, {
    eyebrow: "MONITORING & OPERATIONS",
    title: "The console doesn't sleep. Neither does your risk.",
    subtitle: "Alerts · Reminders · Operations console · Invoice template",
  });
  // Left: alert feed
  rrect(s, { x: 0.55, y: y0 + 0.05, w: 6.2, h: 4.2, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "Real-time alerts", { x: 0.75, y: y0 + 0.18, w: 5.6, h: 0.3, fontSize: 12, color: C.ink, bold: true });
  pill(s, { x: 5.0, y: y0 + 0.2, w: 1.5, h: 0.28, text: "9 unread", fill: C.redSoft, color: C.red, size: 8.5 });
  const alerts = [
    ["critical", C.red, "Invoice #INV-30421 overdue 47 days", "Surveillance · just now"],
    ["warning", C.amber, "Apex Holdings — credit limit at 94%", "Credit limit · 2 min ago"],
    ["warning", C.amber, "Northwind risk grade B → C", "Risk migration · 11 min ago"],
    ["info", C.blue, "Vega Logistics payment received — ₹128K", "Collection · 24 min ago"],
  ];
  alerts.forEach((a, i) => {
    const y = y0 + 0.66 + i * 0.82;
    rrect(s, { x: 0.75, y, w: 5.75, h: 0.8, fill: { color: C.bg }, line: { color: C.line, width: 1 }, rectRadius: 0.08 });
    ellipse(s, { x: 0.95, y: y + 0.3, w: 0.18, h: 0.18, fill: { color: a[1] }, line: { type: "none" } });
    tx(s, a[2], { x: 1.28, y: y + 0.14, w: 4.9, h: 0.3, fontSize: 9.5, color: C.ink, bold: true });
    tx(s, a[3], { x: 1.28, y: y + 0.46, w: 4.9, h: 0.22, fontSize: 8, color: C.muted });
  });
  tx(s, "Severity-tagged (info · warning · critical) · overdue triggers · credit-limit breaches · risk-grade migrations", {
    x: 0.75, y: y0 + 4.0, w: 5.75, h: 0.18, fontSize: 8.5, color: C.muted,
  });
  // Right: ops console + reminders + template
  rrect(s, { x: 7.0, y: y0 + 0.05, w: 5.8, h: 2.6, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "Operations console (admin)", { x: 7.2, y: y0 + 0.18, w: 5.4, h: 0.3, fontSize: 12, color: C.ink, bold: true });
  [
    ["Generate alerts", "one-click surveillance rules"],
    ["Manage team roles", "factor · treasury · checker · operations · sales · reporting"],
    ["Act on exceptions", "review flagged transactions"],
  ].forEach((r, i) => {
    const y = y0 + 0.6 + i * 0.55;
    chip(s, { x: 7.2, y, w: 5.35, h: 0.44, text: r[0], sub: r[1], fill: C.bg, border: C.line, size: 9.5 });
  });
  rrect(s, { x: 7.0, y: y0 + 2.8, w: 5.8, h: 1.45, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "Reminders & branding", { x: 7.2, y: y0 + 2.94, w: 5.4, h: 0.3, fontSize: 12, color: C.ink, bold: true });
  bullets(s, [
    "Automated email reminders keep collections on schedule.",
    "Invoice template: brand every generated invoice & note.",
  ], { x: 7.2, y: y0 + 3.32, w: 5.4, h: 0.85, size: 9.5, gap: 4 });
  // CTA bar
  rrect(s, { x: 0.55, y: y0 + 4.3, w: 12.25, h: 0.6, fill: { color: C.navy }, rectRadius: 0.1 });
  tx(s, "Submit, advance, collect — and watch aging, concentration, and credit risk move in real time.", {
    x: 0.85, y: y0 + 4.3, w: 8.6, h: 0.6, valign: "middle",
    fontSize: 12, color: "FFFFFF", bold: true,
  });
  pill(s, { x: 9.9, y: y0 + 4.4, w: 2.6, h: 0.4, text: "Open a free account →", fill: C.cyan, color: C.navy, size: 10.5 });
  s.addNotes("Closing: alerts (real-time surveillance with severity tags and unread count), reminders (automated collection nudges), operations console (alerts, roles, exceptions), invoice template (branding). Closing CTA: open a free account, no card required.");
}

// ── Write file ──────────────────────────────────────────────────
const outPath = require("path").join(__dirname, "..", "Adventra-Platform-Walkthrough.pptx");
pptx
  .writeFile({ fileName: outPath })
  .then((fn) => console.log("Saved:", fn))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
