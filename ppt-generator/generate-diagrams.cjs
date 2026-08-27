// Adventra — Architecture & Workflow Diagrams deck (20 slides)
// Run: node generate-diagrams.cjs  →  outputs ../Adventra-Architecture-Workflows.pptx
const PptxGenJS = require("pptxgenjs");

const pptx = new PptxGenJS();
pptx.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 });
pptx.layout = "WIDE";
pptx.author = "Adventra";
pptx.company = "Adventra";
pptx.title = "Adventra — Architecture & Workflow Diagrams";
pptx.subject = "System architecture and goods/inventory workflow diagrams";
pptx.theme = { headFontFace: "Segoe UI", bodyFontFace: "Segoe UI", lang: "en-US" };

// ── Palette ─────────────────────────────────────────────────────
const C = {
  navy: "0A2540",
  navySoft: "12335C",
  navySoft2: "16325C",
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
};
const FONT = "Segoe UI";
const W = 13.333;
const H = 7.5;
const TOTAL = 20;

// ── Shape / text helpers ────────────────────────────────────────
const rect = (s, o) => s.addShape(pptx.ShapeType.rect, o);
const rrect = (s, o) => s.addShape(pptx.ShapeType.roundRect, o);
const ellipse = (s, o) => s.addShape(pptx.ShapeType.ellipse, o);
const tx = (s, t, o) =>
  s.addText(t, { fontFace: FONT, color: C.ink, margin: 0, ...o });

// Decorative background + footer
function deco(s, num, opts = {}) {
  s.background = { color: opts.dark ? C.navy : C.bg };
  ellipse(s, {
    x: W - 2.6, y: -1.4, w: 3.6, h: 3.6,
    fill: { color: opts.dark ? C.navySoft2 : C.cyanSoft }, line: { type: "none" },
  });
  ellipse(s, {
    x: W - 1.4, y: 0.5, w: 1.1, h: 1.1,
    fill: { color: opts.dark ? C.blue : C.blueSoft }, line: { type: "none" },
  });
  if (!opts.dark) {
    tx(s, "Adventra — Architecture & Workflow Diagrams", {
      x: 0.55, y: H - 0.42, w: 7.5, h: 0.28,
      fontSize: 8.5, color: C.muted, charSpacing: 0.6,
    });
    tx(s, String(num).padStart(2, "0") + " / " + TOTAL, {
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

// ── Diagram helpers ─────────────────────────────────────────────
// Flow node: rounded rect with optional centered title + sub
function node(s, { x, y, w, h = 0.7, title, sub, fill = C.card, border = C.blue, tcolor = C.ink, size = 10, subSize = 8, dashed = false }) {
  rrect(s, {
    x, y, w, h,
    fill: { color: fill },
    line: dashed ? { color: border, width: 1.1, dashType: "dash" } : { color: border, width: 1.3 },
    rectRadius: 0.09,
  });
  if (sub) {
    tx(s, title, {
      x: x + 0.08, y: y + 0.04, w: w - 0.16, h: h * 0.44,
      fontSize: size, color: tcolor, bold: true, align: "center", valign: "middle", fit: "shrink",
    });
    tx(s, sub, {
      x: x + 0.08, y: y + h * 0.42, w: w - 0.16, h: h * 0.54,
      fontSize: subSize, color: C.slate, align: "center", valign: "middle", fit: "shrink",
    });
  } else {
    tx(s, title, {
      x: x + 0.08, y, w: w - 0.16, h,
      fontSize: size, color: tcolor, bold: true, align: "center", valign: "middle", fit: "shrink",
    });
  }
}

// Horizontal arrow (right), optional label under it
function hArrow(s, { x, y, w = 0.5, h = 0.26, label, lx, ly, lw = 1.6, color = C.blue, lcolor = C.slate, lsize = 8, bold = false }) {
  s.addShape(pptx.ShapeType.rightArrow, { x, y, w, h, fill: { color }, line: { type: "none" } });
  if (label) {
    tx(s, label, {
      x: lx ?? x + w / 2 - lw / 2, y: ly ?? y + h + 0.02, w: lw, h: 0.26,
      fontSize: lsize, color: lcolor, bold, align: "center",
    });
  }
}

// Vertical arrow (down), optional label to its right
function vArrow(s, { x, y, w = 0.24, h = 0.4, label, lx, lw = 3.6, color = C.blue, lcolor = C.slate, lsize = 8.5, bold = false }) {
  s.addShape(pptx.ShapeType.downArrow, { x, y, w, h, fill: { color }, line: { type: "none" } });
  if (label) {
    tx(s, label, {
      x: lx ?? x + w + 0.12, y: y - 0.04, w: lw, h: 0.3,
      fontSize: lsize, color: lcolor, bold, valign: "middle",
    });
  }
}

// Spread `items` evenly between x0 and x1 with arrows between
function spread(s, { x0 = 0.55, x1 = W - 0.55, y, h = 0.8, items, arrowW = 0.52 }) {
  const n = items.length;
  const nodeW = (x1 - x0 - (n - 1) * arrowW) / n;
  items.forEach((it, i) => {
    const x = x0 + i * (nodeW + arrowW);
    node(s, { x, y, w: nodeW, h, ...it });
    if (i < n - 1) {
      hArrow(s, { x: x + nodeW + 0.02, y: y + h / 2 - 0.11, w: arrowW - 0.04, h: 0.22 });
    }
  });
  return { nodeW };
}

// Annotation card under a pipeline node
function ann(s, { x, y, w, h, title, lines, tcolor = C.blue }) {
  rrect(s, { x, y, w, h, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.08 });
  tx(s, title, { x: x + 0.1, y: y + 0.06, w: w - 0.2, h: 0.26, fontSize: 9.5, color: tcolor, bold: true });
  bullets(s, lines, { x: x + 0.08, y: y + 0.32, w: w - 0.16, h: h - 0.4, size: 8, gap: 2.5 });
}

// Numbered steps card
function steps(s, { x, y, w, h, title, items, tcolor = C.blue, size = 9 }) {
  rrect(s, { x, y, w, h, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.09 });
  tx(s, title, { x: x + 0.14, y: y + 0.1, w: w - 0.28, h: 0.3, fontSize: 12, color: tcolor, bold: true });
  const paras = items.map((it, i) => ({
    text: `${i + 1}.  ${it}`,
    options: { breakLine: true, color: C.slate, fontSize: size, fontFace: FONT, paraSpaceAfter: 3.5, lineSpacingMultiple: 0.98 },
  }));
  tx(s, paras, { x: x + 0.14, y: y + 0.46, w: w - 0.28, h: h - 0.56, valign: "top" });
}

// Horizontal status-machine row: label + pills with small arrows
function statusRow(s, { y, label, steps: stps, x0 = 0.55, x1 = W - 0.55, h = 0.4, labelW = 1.85 }) {
  tx(s, label, { x: x0, y: y + 0.02, w: labelW, h, fontSize: 10, color: C.ink, bold: true, valign: "middle" });
  const gap = 0.32;
  const n = stps.length;
  const avail = x1 - x0 - labelW - (n - 1) * gap;
  const pw = Math.min(avail / n, 1.6);
  stps.forEach((st, i) => {
    const x = x0 + labelW + i * (pw + gap);
    const tone = st.tone || "blue";
    const fill = st.fill || (tone === "done" ? C.blueSoft : tone === "warn" ? C.amberSoft : tone === "bad" ? C.redSoft : tone === "green" ? C.greenSoft : C.card);
    const col = st.color || (tone === "done" ? C.blue : tone === "warn" ? C.amber : tone === "bad" ? C.red : tone === "green" ? C.green : C.slate);
    pill(s, { x, y, w: pw, h, text: st.t, fill, color: col, size: 8.5 });
    if (i < n - 1) {
      hArrow(s, { x: x + pw + 0.015, y: y + h / 2 - 0.09, w: gap - 0.03, h: 0.18, color: C.muted });
    }
  });
}

// ════════════════════════════════════════════════════════════════
// SLIDE 1 — TITLE (dark)
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 1, { dark: true });
  tx(s, "TECHNICAL DECK · ARCHITECTURE & WORKFLOWS", {
    x: 0.85, y: 0.95, w: 11.6, h: 0.34,
    fontSize: 13, color: C.cyan, bold: true, charSpacing: 3,
  });
  tx(s, "Adventra", {
    x: 0.82, y: 1.3, w: 11.6, h: 1.3,
    fontSize: 66, color: "FFFFFF", bold: true,
  });
  tx(s, "Architecture & Workflow Diagrams", {
    x: 0.85, y: 2.62, w: 11.6, h: 0.7,
    fontSize: 30, color: "FFFFFF", bold: true,
  });
  tx(s, "The complete system architecture and every goods/inventory workflow, extracted directly from the Adventra implementation — React SPA on Express + DynamoDB, with a race-safe double-entry stock ledger and a shared demand-forecast engine.", {
    x: 0.85, y: 3.42, w: 10.6, h: 1.0,
    fontSize: 13, color: "B7C6DE",
  });
  // Deck map
  const mapY = 4.62;
  rrect(s, { x: 0.85, y: mapY, w: 5.9, h: 1.9, fill: { color: C.navySoft }, line: { color: C.navySoft2, width: 1 }, rectRadius: 0.1 });
  tx(s, "PART A — ARCHITECTURE", { x: 1.05, y: mapY + 0.14, w: 5.5, h: 0.28, fontSize: 10.5, color: C.cyan, bold: true, charSpacing: 1.5 });
  bullets(s, [
    "High-level system · frontend · backend",
    "DynamoDB single-table design",
    "Auth & security · deployment",
  ], { x: 1.05, y: mapY + 0.5, w: 5.5, h: 1.25, size: 10, gap: 5, color: "B7C6DE" });
  rrect(s, { x: 6.95, y: mapY, w: 5.55, h: 1.9, fill: { color: C.navySoft }, line: { color: C.navySoft2, width: 1 }, rectRadius: 0.1 });
  tx(s, "PART B — WORKFLOWS", { x: 7.15, y: mapY + 0.14, w: 5.2, h: 0.28, fontSize: 10.5, color: C.cyan, bold: true, charSpacing: 1.5 });
  bullets(s, [
    "Procurement & sales end-to-end",
    "GRN / Dispatch confirm (the money steps)",
    "Stock ledger · forecasting · maker–checker",
    "Status machines · advances · reversals",
  ], { x: 7.15, y: mapY + 0.5, w: 5.2, h: 1.3, size: 10, gap: 5, color: "B7C6DE" });
  s.addNotes(
    "Title. This deck is the technical companion to the product walkthrough: Part A covers the system architecture (frontend, backend, DynamoDB single-table design, auth/security, deployment); Part B covers every goods and inventory workflow — procurement, sales, the confirmed-document stock rules, the forecast engine, maker–checker gates, status machines, advance deduction, and cancellation semantics."
  );
}

// ════════════════════════════════════════════════════════════════
// SLIDE 2 — HIGH-LEVEL SYSTEM ARCHITECTURE
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 2);
  const y0 = header(s, {
    eyebrow: "PART A · ARCHITECTURE",
    title: "High-level system architecture",
    subtitle: "A two-tier web app: React 19 SPA → Express 4 API → DynamoDB + S3. Nginx serves the SPA and proxies /api in production.",
  });
  // Left: vertical stack
  const cx = 0.55 + 8.6 / 2; // 4.85
  node(s, { x: 0.55, y: y0 + 0.05, w: 8.6, h: 0.85, title: "Browser — React 19 SPA", sub: "TanStack Router · TanStack Query · Tailwind · client-only (static files)", fill: C.blueSoft, border: C.blue, tcolor: C.blue });
  vArrow(s, { x: cx - 0.12, y: y0 + 0.95, h: 0.38, label: "HTTPS · /api · JSON · httpOnly session cookie", lx: 5.0, lw: 4.4, lsize: 8.5 });
  node(s, { x: 0.55, y: y0 + 1.38, w: 8.6, h: 0.85, title: "Nginx (production)", sub: "serves built SPA · SPA fallback → index.html · reverse-proxies /api/* → Express :4040", fill: C.cyanSoft, border: C.cyan, tcolor: "0E7490" });
  vArrow(s, { x: cx - 0.12, y: y0 + 2.28, h: 0.38, label: "/api (REST/JSON)", lx: 5.0, lw: 4.4, lsize: 8.5 });
  node(s, { x: 0.55, y: y0 + 2.71, w: 8.6, h: 0.85, title: "Express 4 + TypeScript API", sub: "PM2-managed Node process · security stack → middleware → routes → model layer", fill: C.navy, border: C.navy, tcolor: "FFFFFF", subSize: 8.5 });
  // split arrows
  vArrow(s, { x: 2.55, y: y0 + 3.6, h: 0.34, label: "AWS SDK v3 · parameterized queries", lx: 2.85, lw: 4.1, lsize: 8 });
  vArrow(s, { x: 6.9, y: y0 + 3.6, h: 0.34, label: "presigned uploads / reads", lx: 7.2, lw: 4.1, lsize: 8 });
  node(s, { x: 0.55, y: y0 + 3.98, w: 4.1, h: 0.9, title: "DynamoDB — single table", sub: "every entity · GSI1 per client, GSI2 per type", fill: C.card, border: C.green, tcolor: C.green });
  node(s, { x: 5.05, y: y0 + 3.98, w: 4.1, h: 0.9, title: "S3 — private bucket", sub: "documents & product images · presigned URLs (120s TTL)", fill: C.card, border: C.amber, tcolor: C.amber });
  // Right: monorepo layout
  rrect(s, { x: 9.45, y: y0 + 0.05, w: 3.35, h: 4.85, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "MONOREPO LAYOUT", { x: 9.6, y: y0 + 0.16, w: 3.05, h: 0.26, fontSize: 9.5, color: C.muted, bold: true, charSpacing: 1 });
  bullets(s, [
    { t: "root package.json", b: true, sub: "runs both apps with concurrently" },
    { t: "frontend/", b: true, sub: "Vite SPA → static files (no Node at runtime)" },
    { t: "backend/", b: true, sub: "Express API · middleware · models" },
    { t: "shared engine", b: true, sub: "forecast-engine.ts — same file, server & client (KEEP IN SYNC)" },
    { t: "deploy/", b: true, sub: "Nginx config · ecosystem.config.cjs (PM2)" },
  ], { x: 9.6, y: y0 + 0.5, w: 3.05, h: 4.2, size: 9, gap: 6 });
  s.addNotes(
    "Architecture. Browser loads a client-only React 19 SPA (static files) from Nginx; the SPA calls /api over HTTPS with a same-origin httpOnly session cookie. Nginx reverse-proxies /api to the Express API on :4040 (PM2-managed). Express talks to a single DynamoDB table and S3 for uploads via the AWS SDK. Monorepo: root package.json runs both apps; the forecast engine is a shared file kept in sync between frontend and backend."
  );
}

// ════════════════════════════════════════════════════════════════
// SLIDE 3 — FRONTEND ARCHITECTURE
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 3);
  const y0 = header(s, {
    eyebrow: "PART A · ARCHITECTURE",
    title: "Frontend architecture",
    subtitle: "Client-only SPA — typed routing, server-state cache, and a shadcn/Radix component layer.",
  });
  // Left: stack card
  rrect(s, { x: 0.55, y: y0, w: 5.9, h: 4.9, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "UI & RENDERING STACK", { x: 0.72, y: y0 + 0.12, w: 5.6, h: 0.26, fontSize: 9.5, color: C.muted, bold: true, charSpacing: 1 });
  const rows3 = [
    ["React 19 + TypeScript 5.8", "function components · typed route tree"],
    ["Vite 7", "dev server · bundling · /api → localhost:4040 proxy"],
    ["TanStack Router", "file-based routes · typed search params (zod)"],
    ["TanStack Query v5", "server-state cache · invalidation"],
    ["Tailwind CSS v4", "utility-first styling"],
    ["shadcn/ui + Radix", "dialog · dropdown · tabs · table · select · tooltip"],
    ["lucide · sonner · cmdk · vaul · embla", "icons · toasts · command palette · drawers · carousel"],
    ["recharts · react-hook-form + zod · date-fns", "charts · forms & validation · dates"],
  ];
  rows3.forEach((r, i) => {
    const y = y0 + 0.46 + i * 0.55;
    chip(s, { x: 0.72, y, w: 5.55, h: 0.48, text: r[0], sub: r[1], fill: C.bg, border: C.line, size: 9 });
  });
  // Right: mechanics card
  rrect(s, { x: 6.75, y: y0, w: 6.05, h: 4.9, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "HOW THE SPA TALKS TO THE API", { x: 6.92, y: y0 + 0.12, w: 5.7, h: 0.26, fontSize: 9.5, color: C.muted, bold: true, charSpacing: 1 });
  bullets(s, [
    { t: "api-client.ts", b: true, sub: "typed fetch wrapper · credentials: include · consistent error objects" },
    { t: "AuthProvider", b: true, sub: "session context calling /auth/me · sequence guard (stale responses can't overwrite fresh sessions) · derived role flags" },
    { t: "Route guards", b: true, sub: "client-side gating is UX only — real enforcement is server-side requireRole" },
    { t: "view-as", b: true, sub: "GETs forward viewAsUserId so reporting managers can impersonate read-only" },
    { t: "Shared forecast engine", b: true, sub: "identical file in frontend & backend — identical math, instant display" },
    { t: "No global store", b: true, sub: "server state → TanStack Query · auth → context · UI state → hooks" },
  ], { x: 6.92, y: y0 + 0.46, w: 5.7, h: 4.3, size: 10, gap: 8 });
  // Bottom strip: request flow
  const fy = y0 + 5.02;
  spread(s, {
    x0: 0.55, x1: W - 0.55, y: fy, h: 0.6,
    items: [
      { title: "User event", sub: "click · submit · cmd+K", fill: C.bg, border: C.line, size: 9.5, subSize: 8 },
      { title: "Route + loader", sub: "TanStack Router", fill: C.bg, border: C.line, size: 9.5, subSize: 8 },
      { title: "Query hook", sub: "TanStack Query cache", fill: C.bg, border: C.line, size: 9.5, subSize: 8 },
      { title: "api-client.ts", sub: "fetch · JSON · errors", fill: C.blueSoft, border: C.blue, size: 9.5, subSize: 8, tcolor: C.blue },
      { title: "/api", sub: "httpOnly cookie", fill: C.navy, border: C.navy, tcolor: "FFFFFF", size: 9.5, subSize: 8 },
    ],
  });
  s.addNotes(
    "Frontend. React 19 + TypeScript on Vite; TanStack Router for typed file-based routing, TanStack Query for server state, Tailwind v4 + shadcn/Radix for UI. The api-client wraps fetch with credentials include and typed errors; AuthProvider manages the session with a sequence guard; client route guards are UX, server requireRole is security; reporting managers impersonate via viewAsUserId. The forecast engine is shared verbatim with the backend."
  );
}

// ════════════════════════════════════════════════════════════════
// SLIDE 4 — BACKEND STACK & MIDDLEWARE CHAIN
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 4);
  const y0 = header(s, {
    eyebrow: "PART A · ARCHITECTURE",
    title: "Backend stack & middleware chain",
    subtitle: "One Express process: a strict middleware pipeline in front of route handlers, with business logic in a model layer.",
  });
  // Left: stack
  rrect(s, { x: 0.55, y: y0, w: 5.2, h: 4.95, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "BACKEND STACK", { x: 0.72, y: y0 + 0.12, w: 4.9, h: 0.26, fontSize: 9.5, color: C.muted, bold: true, charSpacing: 1 });
  const rows4 = [
    ["Runtime", "Node 20+ ESM · Express 4 · TypeScript"],
    ["Auth", "jsonwebtoken · bcryptjs (12 rounds) · cookie-parser"],
    ["Data", "AWS SDK v3 — DynamoDB + S3"],
    ["Uploads", "multer (magic-byte validated)"],
    ["Email / PDF", "nodemailer (SMTP) · pdfkit"],
    ["Validation / IDs", "zod · uuid"],
    ["Security", "helmet · cors · express-rate-limit · slow-down"],
    ["Ops", "dotenv · PM2 (ecosystem.config.cjs)"],
  ];
  rows4.forEach((r, i) => {
    const y = y0 + 0.46 + i * 0.56;
    chip(s, { x: 0.72, y, w: 4.86, h: 0.5, text: r[0], sub: r[1], fill: C.bg, border: C.line, size: 9 });
  });
  // Right: middleware chain (two columns)
  rrect(s, { x: 6.05, y: y0, w: 6.75, h: 4.95, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "MIDDLEWARE CHAIN — IN ORDER", { x: 6.22, y: y0 + 0.12, w: 6.4, h: 0.26, fontSize: 9.5, color: C.muted, bold: true, charSpacing: 1 });
  const chain = [
    ["1 · Boot guard", "prod refuses to start without JWT_SECRET"],
    ["2 · Helmet", "CSP · HSTS (prod) · Permissions-Policy"],
    ["3 · CORS", "origin allowlist"],
    ["4 · Cookie parser", "session cookie"],
    ["5 · Body parsers", "bounded (5 MB JSON)"],
    ["6 · Request logger", "token redaction"],
    ["7 · Sanitizer", "prototype-pollution defense"],
    ["8 · Transform", "snake_case ↔ camelCase"],
    ["9 · CSRF guard", "Origin allowlist on non-GET /api"],
    ["10 · Rate limit", "API-wide backstop + no-store"],
    ["11 · Routes", "REST handlers → models"],
    ["12 · Error handler", "never leaks err.message"],
  ];
  chain.slice(0, 6).forEach((r, i) => {
    const y = y0 + 0.46 + i * 0.56;
    chip(s, { x: 6.22, y, w: 3.05, h: 0.5, text: r[0], sub: r[1], fill: C.bg, border: C.line, size: 8.5 });
  });
  chain.slice(6).forEach((r, i) => {
    const y = y0 + 0.46 + i * 0.56;
    chip(s, { x: 9.6, y, w: 3.05, h: 0.5, text: r[0], sub: r[1], fill: C.bg, border: C.line, size: 8.5 });
  });
  // small connector arrows between columns
  vArrow(s, { x: 9.35, y: y0 + 0.6, h: 0.3, w: 0.18, color: C.muted });
  vArrow(s, { x: 9.35, y: y0 + 2.4, h: 0.3, w: 0.18, color: C.muted });
  // Bottom: organization note
  rrect(s, { x: 0.55, y: y0 + 5.08, w: 12.25, h: 0.72, fill: { color: C.navy }, rectRadius: 0.1 });
  tx(s, "routes/index.ts = thin REST handlers · models/* = DynamoDB CRUD + domain rules (assertSOReceivable, flipToConfirmed, advance deduction) · middleware/* = cross-cutting concerns", {
    x: 0.8, y: y0 + 5.08, w: 11.8, h: 0.72, valign: "middle",
    fontSize: 10.5, color: "FFFFFF",
  });
  s.addNotes(
    "Backend. The left card lists the stack (Express 4, AWS SDK v3, multer, nodemailer, pdfkit, security libs). The right card shows the exact middleware order: boot guard → Helmet → CORS → cookie parser → bounded body parsers → logger with redaction → sanitizer → snake/camel transform → CSRF origin guard → rate limiter → routes → centralized error handler that never leaks internals. Business logic lives in models/*; routes are thin."
  );
}

// ════════════════════════════════════════════════════════════════
// SLIDE 5 — DYNAMODB SINGLE-TABLE DESIGN
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 5);
  const y0 = header(s, {
    eyebrow: "PART A · ARCHITECTURE",
    title: "DynamoDB single-table design",
    subtitle: "One table holds every entity. Access is by key convention; concurrency is solved with conditional updates.",
  });
  // The table
  rrect(s, { x: 0.55, y: y0 + 0.02, w: 12.25, h: 0.8, fill: { color: C.navy }, rectRadius: 0.1 });
  tx(s, "One table «InsightFactor» — every entity in it", {
    x: 0.8, y: y0 + 0.1, w: 11.8, h: 0.3, fontSize: 12.5, color: "FFFFFF", bold: true,
  });
  tx(s, "USER# · PRODUCT# · INV# · PO# · GRN# · DSP# · MOV# · FORECAST# · AUDIT# · CLIENT# · …   (entityType attribute discriminates the shapes)", {
    x: 0.8, y: y0 + 0.44, w: 11.8, h: 0.3, fontSize: 10, color: "B7C6DE",
  });
  // Three cards
  const cardY = y0 + 1.0;
  const cardH = 3.0;
  // Card 1 — keys
  rrect(s, { x: 0.55, y: cardY, w: 3.95, h: cardH, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "KEYS & ACCESS PATTERNS", { x: 0.72, y: cardY + 0.12, w: 3.6, h: 0.26, fontSize: 9.5, color: C.blue, bold: true, charSpacing: 1 });
  bullets(s, [
    { t: "PK / SK", b: true, sub: "identity — SK mirrors PK for simple gets" },
    { t: "GSI1", b: true, sub: "PK=CLIENT#<id> · SK=<Type>#<createdAt> → everything for one client, newest first" },
    { t: "GSI2", b: true, sub: "PK=<entityType> → global per-type queries" },
    { t: "helpers", b: true, sub: "getItem · putItem · updateItem · updateItemIf · queryByGSI1 · scanByType" },
  ], { x: 0.72, y: cardY + 0.44, w: 3.6, h: cardH - 0.55, size: 9, gap: 6 });
  // Card 2 — concurrency
  rrect(s, { x: 4.7, y: cardY, w: 3.95, h: cardH, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "CONCURRENCY CONTROL", { x: 4.87, y: cardY + 0.12, w: 3.6, h: 0.26, fontSize: 9.5, color: C.blue, bold: true, charSpacing: 1 });
  bullets(s, [
    { t: "updateItemIf", b: true, sub: "runs a ConditionExpression — e.g. SET status=:new WHERE status='draft'" },
    { t: "Exactly one winner", b: true, sub: "failed condition → null = “already confirmed” → credit nothing" },
    { t: "Double-clicks harmless", b: true, sub: "duplicate confirms, retries and races become no-ops" },
  ], { x: 4.87, y: cardY + 0.44, w: 3.6, h: cardH - 0.55, size: 9, gap: 7 });
  // Card 3 — relations
  rrect(s, { x: 8.85, y: cardY, w: 3.95, h: cardH, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "RELATIONS WITHOUT JOINS", { x: 9.02, y: cardY + 0.12, w: 3.6, h: 0.26, fontSize: 9.5, color: C.blue, bold: true, charSpacing: 1 });
  bullets(s, [
    { t: "Snapshotting", b: true, sub: "line items copy sku · name · unit · price at creation" },
    { t: "Linked IDs", b: true, sub: "goodsSalesOrderId · poNumber … + app-level aggregation" },
    { t: "Immutable documents", b: true, sub: "deleting a product never corrupts old documents" },
  ], { x: 9.02, y: cardY + 0.44, w: 3.6, h: cardH - 0.55, size: 9, gap: 7 });
  // Bottom trade-off strip
  rrect(s, { x: 0.55, y: cardY + cardH + 0.16, w: 12.25, h: 0.75, fill: { color: C.blueSoft }, line: { color: C.blue, width: 1 }, rectRadius: 0.1 });
  tx(s, "Scalability trade-off: per-client queries hit one GSI1 partition (cheap single-key reads, no connection pooling, no migrations) — cross-entity joins happen in application code; a few places use scanByType (fine at current scale, flagged to move to paginated GSIs).", {
    x: 0.8, y: cardY + cardH + 0.16, w: 11.8, h: 0.75, valign: "middle",
    fontSize: 10, color: C.ink,
  });
  s.addNotes(
    "DynamoDB. One table holds all entities, discriminated by entityType. PK/SK identify items; GSI1 gives everything-for-one-client newest-first; GSI2 gives global per-type queries. Concurrency is handled by updateItemIf conditional updates so exactly one concurrent confirm wins. Relations are modeled by snapshotting line items and storing linked IDs — documents are immutable. Trade-off: joins in app code, and scanByType is a documented scaling concern."
  );
}

// ════════════════════════════════════════════════════════════════
// SLIDE 6 — AUTH & SECURITY FLOWS
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 6);
  const y0 = header(s, {
    eyebrow: "PART A · ARCHITECTURE",
    title: "Auth & security flows",
    subtitle: "Stateless JWT in an httpOnly cookie, with CSRF, rate-limit, upload and RBAC defenses layered on top.",
  });
  // Left: auth flow
  const ax = 0.55, aw = 5.3;
  node(s, { x: ax, y: y0 + 0.05, w: aw, h: 0.68, title: "1 · Login / signup", sub: "email + password · bcrypt 12 rounds", fill: C.bg, border: C.line });
  vArrow(s, { x: ax + aw / 2 - 0.12, y: y0 + 0.78, h: 0.3 });
  node(s, { x: ax, y: y0 + 1.13, w: aw, h: 0.68, title: "2 · Verify credentials", sub: "server-side · failed attempts counted", fill: C.bg, border: C.line });
  vArrow(s, { x: ax + aw / 2 - 0.12, y: y0 + 1.86, h: 0.3 });
  node(s, { x: ax, y: y0 + 2.21, w: aw, h: 0.68, title: "3 · Sign JWT", sub: "7-day expiry · iss / aud / jti claims", fill: C.bg, border: C.line });
  vArrow(s, { x: ax + aw / 2 - 0.12, y: y0 + 2.94, h: 0.3 });
  node(s, { x: ax, y: y0 + 3.29, w: aw, h: 0.68, title: "4 · Set session cookie", sub: "httpOnly · SameSite=Strict · Secure in prod", fill: C.blueSoft, border: C.blue, tcolor: C.blue });
  vArrow(s, { x: ax + aw / 2 - 0.12, y: y0 + 4.02, h: 0.3 });
  node(s, { x: ax, y: y0 + 4.37, w: aw, h: 0.68, title: "5 · Every request", sub: "authMiddleware verifies signature · expiry · issuer → req.user", fill: C.navy, border: C.navy, tcolor: "FFFFFF", subSize: 8 });
  tx(s, "Logout clears the cookie · Authorization: Bearer kept as a script fallback · client JS never sees the token", {
    x: ax, y: y0 + 5.15, w: aw, h: 0.5, fontSize: 8.5, color: C.muted,
  });
  // Right: security controls
  rrect(s, { x: 6.35, y: y0, w: 6.45, h: 5.75, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "SECURITY CONTROLS", { x: 6.52, y: y0 + 0.12, w: 6.1, h: 0.26, fontSize: 9.5, color: C.muted, bold: true, charSpacing: 1 });
  bullets(s, [
    { t: "CSRF — two layers", b: true, sub: "SameSite=Strict cookie + server-side Origin allowlist on every non-GET /api (evil origins get 403)" },
    { t: "Brute force — failed-only limits", b: true, sub: "login 30/15min per IP · 10/15min per account+IP · signup 10/hr · token endpoints 60/15min · API backstop 1000/15min · slow-down throttles repeats" },
    { t: "Uploads — magic bytes", b: true, sub: "rejects HTML/SVG/executables by content, not Content-Type · S3 keys scoped userId/ · presigned URLs" },
    { t: "RBAC — requireRole server-side", b: true, sub: "client · checker · treasury · sales_rep · operations · reporting_manager · factor_admin" },
    { t: "Audit trail", b: true, sub: "append-only log of workflow + security events (actor · action · target · IP · UA)" },
    { t: "Boot guard + error handling", b: true, sub: "no start without JWT_SECRET · centralized handler never leaks err.message" },
  ], { x: 6.52, y: y0 + 0.46, w: 6.1, h: 5.2, size: 9.5, gap: 7 });
  s.addNotes(
    "Auth. Flow: login → bcrypt verify → JWT (7-day, iss/aud/jti) → httpOnly SameSite=Strict cookie → authMiddleware on each request. CSRF is two-layered (SameSite + Origin allowlist); rate limits count only failed attempts so shared NAT IPs are safe; uploads are validated by magic bytes with userId-scoped keys; RBAC is enforced server-side; all workflow and security events go to an append-only audit log."
  );
}

// ════════════════════════════════════════════════════════════════
// SLIDE 7 — DEPLOYMENT & OPERATIONS
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 7);
  const y0 = header(s, {
    eyebrow: "PART A · ARCHITECTURE",
    title: "Deployment & operations",
    subtitle: "Build both apps, ship static files + one Node process, run under PM2 behind Nginx with Let's Encrypt TLS.",
  });
  const colY = y0, colH = 3.3;
  // Build
  rrect(s, { x: 0.55, y: colY, w: 3.95, h: colH, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "1 · BUILD", { x: 0.72, y: colY + 0.12, w: 3.6, h: 0.26, fontSize: 10, color: C.blue, bold: true, charSpacing: 1.2 });
  bullets(s, [
    { t: "frontend", b: true, sub: "vite build → dist/ (hashed static assets)" },
    { t: "backend", b: true, sub: "tsc build → dist/server.js" },
    { t: "Env split", b: true, sub: "VITE_* baked into the JS bundle at build time · backend .env read at runtime" },
  ], { x: 0.72, y: colY + 0.46, w: 3.6, h: colH - 0.6, size: 9.5, gap: 8 });
  // Deploy
  rrect(s, { x: 4.7, y: colY, w: 3.95, h: colH, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "2 · DEPLOY", { x: 4.87, y: colY + 0.12, w: 3.6, h: 0.26, fontSize: 10, color: C.blue, bold: true, charSpacing: 1.2 });
  bullets(s, [
    { t: "PM2", b: true, sub: "fork mode · auto-restart · max-memory 500 MB" },
    { t: "Nginx", b: true, sub: "serves SPA · SPA fallback → index.html · /api → localhost:4040 · /assets cached 1 yr" },
    { t: "TLS", b: true, sub: "Let's Encrypt via certbot, auto-renewing" },
  ], { x: 4.87, y: colY + 0.46, w: 3.6, h: colH - 0.6, size: 9.5, gap: 8 });
  // Run
  rrect(s, { x: 8.85, y: colY, w: 3.95, h: colH, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "3 · RUN", { x: 9.02, y: colY + 0.12, w: 3.6, h: 0.26, fontSize: 10, color: C.blue, bold: true, charSpacing: 1.2 });
  bullets(s, [
    { t: "AWS", b: true, sub: "DynamoDB table + S3 bucket (private)" },
    { t: "Scheduler", b: true, sub: "hourly reminder cron — once/day per invoice (lastOverdueReminderDate)" },
    { t: "Forecast", b: true, sub: "recompute on startup + after every stock event (async)" },
    { t: "Boot", b: true, sub: "seed / promote admin from env" },
  ], { x: 9.02, y: colY + 0.46, w: 3.6, h: colH - 0.6, size: 9.5, gap: 6 });
  // Env strip
  const envY = colY + colH + 0.18;
  tx(s, "ENVIRONMENT-DRIVEN —", { x: 0.55, y: envY + 0.06, w: 1.9, h: 0.3, fontSize: 10, color: C.ink, bold: true, valign: "middle" });
  const envs = ["PORT", "NODE_ENV", "JWT_SECRET", "AWS_*", "DYNAMODB_TABLE", "S3_BUCKET", "CORS_ORIGIN", "SMTP_*", "APP_URL", "RL_*"];
  envs.forEach((e, i) => {
    const x = 2.55 + i * 1.03;
    pill(s, { x, y: envY, w: 0.95, h: 0.42, text: e, fill: C.blueSoft, color: C.blue, size: 8.5 });
  });
  tx(s, "· prod refuses to start with a missing/weak JWT_SECRET", {
    x: 0.55, y: envY + 0.5, w: 12.2, h: 0.3, fontSize: 9.5, color: C.muted,
  });
  s.addNotes(
    "Deployment. Build: vite for the SPA (static), tsc for the API. Deploy: PM2 fork mode with auto-restart; Nginx serves the SPA with fallback and proxies /api to :4040; certbot handles TLS. Run: DynamoDB + S3; an hourly scheduler sends once-per-day overdue reminders; forecasts recompute on startup and after stock events; the admin user is seeded from env. Everything is env-driven."
  );
}

// ════════════════════════════════════════════════════════════════
// SLIDE 8 — PART B DIVIDER (dark)
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 8, { dark: true });
  tx(s, "PART B · BUSINESS WORKFLOWS", {
    x: 0.85, y: 1.35, w: 11.6, h: 0.4,
    fontSize: 15, color: C.cyan, bold: true, charSpacing: 3.5,
  });
  tx(s, "From procurement to payment — every flow, mapped", {
    x: 0.82, y: 1.85, w: 11.6, h: 0.85,
    fontSize: 34, color: "FFFFFF", bold: true,
  });
  tx(s, "The one rule that ties everything together: a document never touches stock — only a confirmed goods document does.", {
    x: 0.85, y: 2.85, w: 11.0, h: 0.6,
    fontSize: 14, color: "B7C6DE", italic: true,
  });
  const cols = [
    ["9 · The ONE rule — documents never touch stock", "10 · Procurement: proforma → PO → invoice → GRN", "11 · Sales: quotation → SO → dispatch → invoice", "12 · GRN & dispatch confirm — the money steps", "13 · Inventory ledger & live stock"],
    ["14 · Demand-forecasting engine pipeline", "15 · Reorder recommendation & timelines", "16 · Maker–checker approval & RBAC roles", "17 · Dual-track status machines", "18 · Advance deduction & payments", "19 · Cancellation & reversal semantics", "20 · The invariants that keep the ledger truthful"],
  ];
  cols.forEach((list, ci) => {
    const x = 0.85 + ci * 5.95;
    list.forEach((t, i) => {
      const y = 3.7 + i * 0.5;
      tx(s, t, { x, y, w: 5.7, h: 0.4, fontSize: 12.5, color: "FFFFFF" });
      ellipse(s, { x: x - 0.28, y: y + 0.14, w: 0.12, h: 0.12, fill: { color: C.cyan }, line: { type: "none" } });
    });
  });
  s.addNotes(
    "Divider for Part B: business workflows. The core rule — a document never touches stock; only a confirmed GRN or dispatch does — is what every subsequent slide builds on."
  );
}

// ════════════════════════════════════════════════════════════════
// SLIDE 9 — THE ONE RULE
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 9);
  const y0 = header(s, {
    eyebrow: "PART B · WORKFLOWS",
    title: "The ONE rule: documents never touch stock",
    subtitle: "Only a confirmed goods document moves inventory. This rule is repeated in the UI so users always know why an order doesn't change stock.",
  });
  // Banner
  rrect(s, { x: 0.55, y: y0 + 0.02, w: 12.25, h: 0.6, fill: { color: C.navy }, rectRadius: 0.1 });
  tx(s, "“A document never touches stock — only a CONFIRMED goods document does.”", {
    x: 0.8, y: y0 + 0.02, w: 11.8, h: 0.6, valign: "middle",
    fontSize: 13.5, color: "FFFFFF", bold: true, align: "center",
  });
  // Panels
  const py = y0 + 0.78, ph = 1.5;
  rrect(s, { x: 0.55, y: py, w: 6.0, h: ph, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "PURCHASE SIDE", { x: 0.72, y: py + 0.08, w: 5.7, h: 0.24, fontSize: 9, color: C.muted, bold: true, charSpacing: 1.2 });
  node(s, { x: 0.72, y: py + 0.38, w: 2.35, h: 0.95, title: "PO · Proforma · PI", sub: "no stock effect", fill: C.bg, border: C.line, size: 9.5 });
  hArrow(s, { x: 3.12, y: py + 0.78, w: 0.55, h: 0.22 });
  node(s, { x: 3.72, y: py + 0.38, w: 2.68, h: 0.95, title: "GRN confirmed", sub: "Stock IN — accepted qty", fill: C.greenSoft, border: C.green, tcolor: C.green, size: 9.5 });
  rrect(s, { x: 6.78, y: py, w: 6.0, h: ph, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "SALES SIDE", { x: 6.95, y: py + 0.08, w: 5.7, h: 0.24, fontSize: 9, color: C.muted, bold: true, charSpacing: 1.2 });
  node(s, { x: 6.95, y: py + 0.38, w: 2.35, h: 0.95, title: "Quotation · SO · Invoice", sub: "no stock effect", fill: C.bg, border: C.line, size: 9.5 });
  hArrow(s, { x: 9.35, y: py + 0.78, w: 0.55, h: 0.22 });
  node(s, { x: 9.95, y: py + 0.38, w: 2.68, h: 0.95, title: "Dispatch confirmed", sub: "Stock OUT — dispatched qty", fill: C.amberSoft, border: C.amber, tcolor: C.amber, size: 9.5 });
  // Mapping table
  const ty = py + ph + 0.16;
  mockTable(s, {
    x: 0.55, y: ty, w: 12.25,
    colW: [3.4, 5.0, 3.85],
    headers: ["Document", "Stock effect", "When"],
    rows: [
      [{ t: "Purchase Order (PO)" }, { t: "None" }, { t: "—" }],
      [{ t: "Supplier proforma (purchase)" }, { t: "None" }, { t: "—" }],
      [{ t: "Purchase Invoice (PI)" }, { t: "None" }, { t: "—" }],
      [{ t: "GRN", b: true, color: C.green }, { t: "Stock IN (accepted qty)", color: C.green }, { t: "On Confirm only" }],
      [{ t: "Quotation" }, { t: "None" }, { t: "—" }],
      [{ t: "Sales Order (SO)" }, { t: "None" }, { t: "—" }],
      [{ t: "Dispatch note", b: true, color: C.amber }, { t: "Stock OUT (dispatched qty)", color: C.amber }, { t: "On Confirm only" }],
      [{ t: "Return (customer)" }, { t: "Stock IN (returned qty)", color: C.green }, { t: "On Record Return" }],
      [{ t: "Manual movement" }, { t: "Stock IN / OUT" }, { t: "On Confirm only" }],
    ],
    rowH: 0.27,
  });
  s.addNotes(
    "The one rule. Draft/cancelled movements never count; live stock is derived from confirmed movements only. The table maps every document to its stock effect: only confirmed GRNs (stock-in), confirmed dispatches (stock-out), returns and confirmed manual movements touch inventory. Orders, proformas, quotations and invoices are commitments — never stock events."
  );
}

// ════════════════════════════════════════════════════════════════
// SLIDE 10 — PROCUREMENT WORKFLOW
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 10);
  const y0 = header(s, {
    eyebrow: "PART B · WORKFLOWS",
    title: "Procurement workflow — end to end",
    subtitle: "Supplier proforma → Purchase Order → Purchase Invoice → GRN → Stock IN. The GRN is the only purchase-side stock event.",
  });
  const ny = y0 + 0.08, nh = 0.72;
  const { nodeW } = spread(s, {
    x0: 0.55, x1: W - 0.55, y: ny, h: nh,
    items: [
      { title: "Supplier proforma", sub: "quotation · side=purchase", fill: C.bg, border: C.line, size: 9.5 },
      { title: "Purchase Order", sub: "the commitment", fill: C.blueSoft, border: C.blue, tcolor: C.blue, size: 9.5 },
      { title: "Purchase Invoice", sub: "supplier payable", fill: C.bg, border: C.line, size: 9.5 },
      { title: "GRN", sub: "receipt · stock IN", fill: C.greenSoft, border: C.green, tcolor: C.green, size: 9.5 },
      { title: "Stock IN", sub: "confirmed movements", fill: C.navy, border: C.navy, tcolor: "FFFFFF", size: 9.5 },
    ],
  });
  const ay = ny + nh + 0.14, ah = 4.0;
  const anns = [
    { title: "LIFECYCLE + FUNDING", lines: [
      "received → reviewed → converted_to_po | expired | cancelled",
      "funding: pending_review → approved → funded | rejected",
      "convert to PO gated on checker approval — enforced server-side",
      "advancePct feeds the funding pipeline",
    ]},
    { title: "THE COMMITMENT", lines: [
      "draft → approved → sent → partially_received → fully_received",
      "approve (admin/checker) · mark sent · cancel — explicit actions",
      "editable only while draft/approved",
      "lines with receivedQty can't be reduced below received",
      "derived statuses from GRNs; manualStatus stored separately",
    ]},
    { title: "NEVER TOUCHES STOCK", lines: [
      "requires an approved & sent PO (goodsPurchaseOrderId mandatory)",
      "billed qty/price editable from supplier's invoice",
      "diff checks: qty ≠ GRN · price ≠ PO (warn-only)",
      "draft → verified → approved_for_payment → partially_paid → paid",
      "stores NET payable after advance deduction",
    ]},
    { title: "THE ONLY STOCK-IN", lines: [
      "against a PO when goods arrive",
      "lines: orderedQty · receivedQty · acceptedQty · rejectedQty",
      "draft → confirmed → cancelled",
      "confirm = atomic, race-safe, idempotent",
      "cancelling creates stock-OUT reversals + PO revoke",
    ]},
    { title: "INVENTORY LEDGER", lines: [
      "confirmed movements linked to the GRN",
      "reason: “Goods receipt”",
      "acceptedQty folded into PO receivedQty",
      "linked PI back-filled (grnReceivedQty)",
      "forecasts recompute async",
    ]},
  ];
  anns.forEach((a, i) => {
    ann(s, { x: 0.55 + i * (nodeW + 0.52), y: ay, w: nodeW, h: ah, title: a.title, lines: a.lines, tcolor: i === 3 ? C.green : C.blue });
  });
  s.addNotes(
    "Procurement. Supplier proforma (purchase-side quotation) → Purchase Order (the commitment) → Purchase Invoice (payable, links the PO, never touches stock) → GRN (the only stock-in document, on confirm) → confirmed stock-in movements. Note the gates: convert-to-PO needs checker approval; purchase invoices need an approved and sent PO; GRN confirm requires a sent/partially-received PO. Cancelling a GRN reverses stock and revokes PO receipt."
  );
}

// ════════════════════════════════════════════════════════════════
// SLIDE 11 — SALES WORKFLOW
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 11);
  const y0 = header(s, {
    eyebrow: "PART B · WORKFLOWS",
    title: "Sales workflow — end to end",
    subtitle: "Quotation → Sales Order → Dispatch → Sales Invoice → NOA / reminders / payment. Dispatch is the only sales-side stock event.",
  });
  const ny = y0 + 0.08, nh = 0.72;
  const { nodeW } = spread(s, {
    x0: 0.55, x1: W - 0.55, y: ny, h: nh,
    items: [
      { title: "Quotation", sub: "the offer", fill: C.bg, border: C.line, size: 9.5 },
      { title: "Sales Order", sub: "the confirmed order", fill: C.blueSoft, border: C.blue, tcolor: C.blue, size: 9.5 },
      { title: "Dispatch", sub: "stock OUT", fill: C.amberSoft, border: C.amber, tcolor: C.amber, size: 9.5 },
      { title: "Sales Invoice", sub: "billing after dispatch", fill: C.bg, border: C.line, size: 9.5 },
      { title: "NOA · Reminders · Payment", sub: "collections", fill: C.navy, border: C.navy, tcolor: "FFFFFF", size: 9.5 },
    ],
  });
  const ay = ny + nh + 0.14, ah = 4.0;
  const anns = [
    { title: "THE OFFER", lines: [
      "never touches inventory or accounting",
      "lifecycle: draft → sent → accepted | rejected | expired → converted_to_so",
      "maker–checker price approval: pending_review → approved | rejected",
      "optional debtor approval via emailed token link",
      "convert → SO only when price approved",
    ]},
    { title: "THE CONFIRMED ORDER", lines: [
      "draft → confirmed → partially_dispatched → fully_dispatched",
      "optional debtor approval (secure token email)",
      "editable only while draft/confirmed",
      "lines with dispatchedQty protected",
      "recordDispatch guards draft/cancelled/fully-dispatched",
    ]},
    { title: "THE ONLY STOCK-OUT", lines: [
      "against a confirmed SO, with live available-stock check",
      "draft → confirmed → partially_delivered → delivered → returned",
      "confirm = atomic, race-safe, idempotent",
      "soft stock check: warn, don't block",
      "deliver: no stock impact · return: stock back IN + SO re-opened",
    ]},
    { title: "BILLING AFTER DISPATCH", lines: [
      "must link a confirmed SO — customer & lines validated",
      "draft → pending (Issued) → approved → funded → advanced → paid",
      "NOA email with PDF + token · reminders once/day",
      "stores NET receivable after advance deduction",
      "paid / cancelled invoices frozen",
    ]},
    { title: "COLLECTIONS", lines: [
      "NOA public page: token → accept | reject | comment",
      "overdue reminders: daily cron, once per day",
      "recordPayment accumulates amountReceived → partially_paid | paid",
      "paidDate + lateDays recorded",
      "admin can send reminders manually",
    ]},
  ];
  anns.forEach((a, i) => {
    ann(s, { x: 0.55 + i * (nodeW + 0.52), y: ay, w: nodeW, h: ah, title: a.title, lines: a.lines, tcolor: i === 2 ? C.amber : C.blue });
  });
  s.addNotes(
    "Sales. Quotation (offer, dual approval tracks) → Sales Order (confirmed commitment) → Dispatch (the only stock-out document, on confirm) → Sales Invoice (must link a confirmed SO; NOA + reminders + payments) → collections. Same pattern as procurement mirrored: only a confirmed dispatch debits stock; deliveries don't; returns credit stock back in and reopen the SO for re-dispatch."
  );
}

// ════════════════════════════════════════════════════════════════
// SLIDE 12 — GRN & DISPATCH CONFIRM (MONEY STEPS)
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 12);
  const y0 = header(s, {
    eyebrow: "PART B · WORKFLOWS",
    title: "GRN & dispatch confirm — the money steps",
    subtitle: "Idempotent + race-safe: a conditional status flip guarantees exactly one concurrent confirm wins.",
  });
  const ch = 4.6;
  steps(s, {
    x: 0.55, y: y0, w: 6.0, h: ch, tcolor: C.green,
    title: "GRN CONFIRM → STOCK IN",
    items: [
      "Re-validate against the live PO (assertPOReceivable) — not draft/cancelled/fully received; over-receipt needs admin/checker + explicit flag",
      "Atomic flipToConfirmed — conditional update `status='draft'`; exactly one concurrent confirm wins",
      "Create confirmed stock-IN movements for acceptedQty, linked to the GRN (reason “Goods receipt”)",
      "Fold acceptedQty into PO receivedQty; recompute PO status",
      "Back-fill the linked purchase invoice (grnReceivedQty)",
      "Recompute forecasts (async)",
    ],
    size: 9.5,
  });
  steps(s, {
    x: 6.78, y: y0, w: 6.0, h: ch, tcolor: C.amber,
    title: "DISPATCH CONFIRM → STOCK OUT",
    items: [
      "Re-validate against the live SO (assertSODispatchable) — qty vs pending",
      "Soft stock check — warn when dispatched qty exceeds live available stock (doesn't block)",
      "Atomic flip → create confirmed stock-OUT movements, linked to the dispatch (reason “Dispatch”)",
      "Fold dispatchedQty into the SO; recompute status",
      "Mark delivered: deliveryDate + derived partially_delivered/delivered — no stock impact (already debited)",
      "Record return: stock back IN (reason “Customer return”) + SO re-openable for re-dispatch",
    ],
    size: 9.5,
  });
  rrect(s, { x: 0.55, y: y0 + ch + 0.18, w: 12.25, h: 0.72, fill: { color: C.navy }, rectRadius: 0.1 });
  tx(s, "Double-clicks and duplicate requests are harmless: a failed condition returns null = “already confirmed” → credit nothing. Cancelling reverses the effect (stock-OUT reversals + PO revoke for GRN; stock-IN reversals + SO revoke for dispatch).", {
    x: 0.8, y: y0 + ch + 0.18, w: 11.8, h: 0.72, valign: "middle",
    fontSize: 10.5, color: "FFFFFF",
  });
  s.addNotes(
    "Money steps. GRN confirm (stock-in) and dispatch confirm (stock-out) are the only places inventory moves on the goods documents. Both re-validate against the live parent document, flip status atomically via a DynamoDB conditional update, create confirmed movements, and fold quantities into the parent. Delivery has no stock impact; returns credit stock back in. Cancellation reverses the exact effect."
  );
}

// ════════════════════════════════════════════════════════════════
// SLIDE 13 — INVENTORY LEDGER
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 13);
  const y0 = header(s, {
    eyebrow: "PART B · WORKFLOWS",
    title: "Inventory — the stock ledger",
    subtitle: "Atomic, append-only movement records. Live stock is derived, never stored.",
  });
  // Invariant banner
  rrect(s, { x: 0.55, y: y0 + 0.02, w: 12.25, h: 0.72, fill: { color: C.navy }, rectRadius: 0.1 });
  tx(s, "liveStock = Σ confirmed(IN) − Σ confirmed(OUT)", {
    x: 0.8, y: y0 + 0.02, w: 11.8, h: 0.4, fontSize: 18, color: "FFFFFF", bold: true, align: "center",
  });
  tx(s, "drafts & cancelled entries never count · live stock is recomputed from the ledger, never stored as a number", {
    x: 0.8, y: y0 + 0.44, w: 11.8, h: 0.26, fontSize: 9.5, color: "B7C6DE", align: "center",
  });
  // Cards
  const cy = y0 + 0.94, ch2 = 3.35;
  rrect(s, { x: 0.55, y: cy, w: 5.95, h: ch2, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "MOVEMENT LIFECYCLE & EDIT RULES", { x: 0.72, y: cy + 0.12, w: 5.6, h: 0.26, fontSize: 9.5, color: C.blue, bold: true, charSpacing: 1 });
  bullets(s, [
    { t: "draft → confirmed → cancelled", b: true, sub: "only confirmed entries affect the balance" },
    { t: "System-created (GRN / dispatch / return)", b: true, sub: "immutable — UI hides edit/confirm/cancel (“manage it from the GRN, invoice or dispatch instead”)" },
    { t: "Manual drafts", b: true, sub: "editable · confirmable · cancellable · deletable" },
    { t: "Confirmed manual entries", b: true, sub: "editable / cancellable but not deletable" },
    { t: "Cancel ≠ reversal", b: true, sub: "cancelling a confirmed +100 leaves the balance at 0, not −100" },
  ], { x: 0.72, y: cy + 0.44, w: 5.6, h: ch2 - 0.55, size: 9.5, gap: 6.5 });
  rrect(s, { x: 6.83, y: cy, w: 5.95, h: ch2, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "MOVEMENT RECORD (ONE ROW = ONE EVENT)", { x: 7.0, y: cy + 0.12, w: 5.6, h: 0.26, fontSize: 9.5, color: C.blue, bold: true, charSpacing: 1 });
  bullets(s, [
    { t: "movementNumber MOV-XXXXXXXX", b: true, sub: "productId · direction (in = Credit / out = Debit)" },
    { t: "Snapshots from the catalogue", b: true, sub: "itemName · sku · unit — never typed" },
    { t: "Valuation", b: true, sub: "quantity · unitCost · warehouse · reason" },
    { t: "Provenance", b: true, sub: "linkedDocumentType + Number · movementDate" },
    { t: "Attribution", b: true, sub: "createdBy · confirmedBy · cancelledBy · timestamps" },
  ], { x: 7.0, y: cy + 0.44, w: 5.6, h: ch2 - 0.55, size: 9.5, gap: 6.5 });
  // Reasons strip
  const ry = cy + ch2 + 0.16;
  tx(s, "MANUAL MOVEMENT REASONS —", { x: 0.55, y: ry + 0.08, w: 2.1, h: 0.3, fontSize: 9.5, color: C.ink, bold: true, valign: "middle" });
  const reasons = [
    ["Opening stock", "in"], ["Stock adjustment", "in"], ["Damage", "out"],
    ["Samples / internal use", "out"], ["Customer return", "in"], ["Supplier return", "out"],
  ];
  reasons.forEach((r, i) => {
    const x = 2.75 + i * 1.72;
    pill(s, { x, y: ry, w: 1.62, h: 0.42, text: r[0], fill: r[1] === "in" ? C.greenSoft : C.amberSoft, color: r[1] === "in" ? C.green : C.amber, size: 8.5 });
  });
  tx(s, "Manual entries start as drafts and only affect stock once confirmed (Save-draft / Save-&-confirm).", {
    x: 0.55, y: ry + 0.5, w: 12.2, h: 0.3, fontSize: 9, color: C.muted,
  });
  s.addNotes(
    "Inventory. Every stock event is one atomic ledger row; live stock is always derived as confirmed in minus confirmed out. System-created movements are immutable (manage from the source document); manual drafts follow a save-draft/confirm flow; cancelling a confirmed movement drops it from the balance rather than creating a reversal. Manual reasons include opening stock, adjustments, damage, samples, and returns."
  );
}

// ════════════════════════════════════════════════════════════════
// SLIDE 14 — DEMAND FORECASTING ENGINE
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 14);
  const y0 = header(s, {
    eyebrow: "PART B · WORKFLOWS",
    title: "Demand-forecasting engine — 13-step pipeline",
    subtitle: "A seasonal weighted-trend model over 12 months of confirmed stock-outs, recomputed live on both server and client.",
  });
  const rows14 = [
    [
      ["1 · Bucket", "outbound movements by calendar month (12 trailing)"],
      ["2 · Availability correction", "actual ÷ max(availabilityRate, 0.7) · cap 1.4×"],
      ["3 · Weighted baseline", "newest 3 mo ×3 · next 3 ×2 · oldest 6 ×1"],
      ["4 · OLS trend", "slope + R² → up / down / stable"],
      ["5 · Seasonality", "monthAvg ÷ overallAvg · clamp 0.5–2.0"],
    ],
    [
      ["6 · Forecast horizon", "6-mo: baseline × trend × season × factors · clamp 0.7–1.5× · 80% prediction intervals"],
      ["7 · Live pace adjustment", "actual vs expected-to-date · clamp 0.8–1.2 · next month only"],
      ["8 · Days of cover", "stock ÷ (last-3-mo demand ÷ their calendar days)"],
      ["9 · Reorder recommendation", "lead-time + safety-stock math (next slide)"],
      ["10 · Timeline", "stockout date · reorder-by · next refill · urgency"],
    ],
    [
      ["11 · Momentum", "accelerating | stable | declining | inactive"],
      ["12 · Velocity (category-relative)", "dead | fast_mover | medium_mover | slow_mover"],
      ["13 · Pricing strategy", "recommendation only — clearance / markdown / hold / protect margin · floor = unitCost ÷ (1 − minMargin)"],
    ],
  ];
  const rowY = [y0 + 0.05, y0 + 0.95, y0 + 1.85];
  const chipW = (12.25 - 4 * 0.42) / 5;
  rows14.forEach((row, ri) => {
    row.forEach((c, ci) => {
      const x = 0.55 + ci * (chipW + 0.42);
      const last = ri === 2 && ci === row.length - 1;
      node(s, {
        x, y: rowY[ri], w: ri === 2 ? (row.length === 3 ? chipW + 0.42 * 0 + 0.42 * (2 / 3) : chipW) : chipW,
        h: 0.82,
        title: c[0], sub: c[1],
        fill: last ? C.navy : C.card, border: last ? C.navy : C.blue,
        tcolor: last ? "FFFFFF" : C.ink, size: 9.5, subSize: 7.5,
      });
      if (ci < row.length - 1) {
        hArrow(s, { x: x + chipW + 0.02, y: rowY[ri] + 0.36, w: 0.38, h: 0.2, color: C.muted });
      }
    });
    if (ri < 2) {
      vArrow(s, { x: W - 1.05, y: rowY[ri] + 0.86, w: 0.2, h: 0.1, color: C.muted });
    }
  });
  // Footer banner
  rrect(s, { x: 0.55, y: y0 + 2.85, w: 12.25, h: 0.95, fill: { color: C.blueSoft }, line: { color: C.blue, width: 1 }, rectRadius: 0.1 });
  tx(s, "Shared engine — the same file runs on server and client (KEEP IN SYNC): the server persists authoritative snapshots, the client runs identical math for instant display.", {
    x: 0.8, y: y0 + 2.9, w: 11.8, h: 0.3, fontSize: 10.5, color: C.ink, bold: true,
  });
  tx(s, "Recompute triggers: any stock-affecting event (movement create/update/confirm/cancel/delete · GRN confirm · dispatch confirm/return · product delete) + daily freshness check + server startup. Snapshot per SKU (ForecastVariable) with last-writer-wins de-dup; non-finite numbers persisted as null so one quiet SKU can't crash the batch.", {
    x: 0.8, y: y0 + 3.24, w: 11.8, h: 0.5, fontSize: 9.5, color: C.slate,
  });
  s.addNotes(
    "Forecast engine. Per SKU: bucket 12 months of confirmed stock-outs → availability correction → weighted baseline → OLS trend → seasonality → 6-month horizon with 80% intervals → live pace adjustment → days of cover → reorder recommendation → timeline/urgency → momentum and velocity tags → pricing recommendation (never auto-applied). The engine is shared verbatim between server and client; recomputes fire on every stock-affecting event plus a daily check and startup."
  );
}

// ════════════════════════════════════════════════════════════════
// SLIDE 15 — REORDER RECOMMENDATION
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 15);
  const y0 = header(s, {
    eyebrow: "PART B · WORKFLOWS",
    title: "Reorder recommendation & timelines",
    subtitle: "Lead-time demand + safety stock, minus inventory position — rounded to MOQ and order multiples.",
  });
  // Left: formulas
  rrect(s, { x: 0.55, y: y0, w: 6.4, h: 3.3, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "THE MATH", { x: 0.72, y: y0 + 0.12, w: 6.0, h: 0.26, fontSize: 9.5, color: C.blue, bold: true, charSpacing: 1.2 });
  const formulas = [
    ["dailyAvg", "corrected demand (last 3 calendar months) ÷ their actual calendar days"],
    ["requiredStock", "dailyAvg × (leadTimeDays + safetyStockDays)"],
    ["recommended", "max(0, requiredStock − inventoryPosition) → cap by maxCoverDays → raise to minimumOrderQty → round up to orderMultiple"],
    ["floor price", "unitCost ÷ (1 − minimumGrossMargin)"],
  ];
  formulas.forEach((f, i) => {
    const y = y0 + 0.5 + i * 0.68;
    rrect(s, { x: 0.72, y, w: 2.05, h: 0.58, fill: { color: C.blueSoft }, line: { type: "none" }, rectRadius: 0.08 });
    tx(s, f[0], { x: 0.72, y, w: 2.05, h: 0.58, fontSize: 11, color: C.blue, bold: true, align: "center", valign: "middle", fit: "shrink" });
    tx(s, f[1], { x: 2.95, y: y + 0.02, w: 3.85, h: 0.58, fontSize: 9.5, color: C.slate, valign: "middle" });
  });
  // Right: timeline
  rrect(s, { x: 7.25, y: y0, w: 5.55, h: 3.3, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "PER-SKU TIMELINE", { x: 7.42, y: y0 + 0.12, w: 5.2, h: 0.26, fontSize: 9.5, color: C.blue, bold: true, charSpacing: 1.2 });
  const tlY = y0 + 1.5;
  rect(s, { x: 7.55, y: tlY + 0.18, w: 4.95, h: 0.045, fill: { color: C.line }, line: { type: "none" } });
  const tl = [
    { x: 7.55, t: "TODAY", sub: "" },
    { x: 8.9, t: "nextRefillDate", sub: "today + lead time" },
    { x: 10.25, t: "reorderByDate", sub: "stockout − lead time" },
    { x: 11.6, t: "stockoutDate", sub: "today + days of cover" },
  ];
  tl.forEach((p, i) => {
    ellipse(s, { x: p.x - 0.07, y: tlY + 0.1, w: 0.18, h: 0.18, fill: { color: i === 3 ? C.red : C.blue }, line: { type: "none" } });
    tx(s, p.t, { x: p.x - 0.85, y: tlY + 0.38, w: 1.7, h: 0.26, fontSize: 8.5, color: C.ink, bold: true, align: "center" });
    tx(s, p.sub, { x: p.x - 0.85, y: tlY + 0.64, w: 1.7, h: 0.5, fontSize: 7.5, color: C.muted, align: "center" });
  });
  tx(s, "“Reorder window”: between reorderByDate and stockoutDate — order before you run out.", {
    x: 7.42, y: tlY + 1.25, w: 5.2, h: 0.3, fontSize: 9, color: C.muted,
  });
  // Bottom: tags & urgency
  const by = y0 + 3.5;
  rrect(s, { x: 0.55, y: by, w: 6.4, h: 2.3, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "CLASSIFICATION TAGS", { x: 0.72, y: by + 0.12, w: 6.0, h: 0.26, fontSize: 9.5, color: C.blue, bold: true, charSpacing: 1.2 });
  const tagRow = (label, pills_) => {
    tx(s, label, { x: 0.72, y: by + 0.5, w: 1.5, h: 0.34, fontSize: 9, color: C.slate, bold: true, valign: "middle" });
    pills_.forEach((p, i) => {
      pill(s, { x: 2.3 + i * 1.1, y: by + 0.5, w: 1.0, h: 0.34, text: p.t, fill: p.f, color: p.c, size: 8 });
    });
  };
  tagRow("Velocity", [
    { t: "fast", f: C.greenSoft, c: C.green }, { t: "medium", f: C.blueSoft, c: C.blue },
    { t: "slow", f: C.amberSoft, c: C.amber }, { t: "dead", f: C.redSoft, c: C.red },
  ]);
  tagRow("Momentum", [
    { t: "accelerating", f: C.greenSoft, c: C.green }, { t: "stable", f: C.blueSoft, c: C.blue },
    { t: "declining", f: C.amberSoft, c: C.amber }, { t: "inactive", f: C.redSoft, c: C.red },
  ]);
  tx(s, "Velocity is ranked within each category (top 20% = fast, next 30% = medium, rest = slow, 3-mo no sales = dead).", {
    x: 0.72, y: by + 1.0, w: 5.6, h: 0.5, fontSize: 8.5, color: C.muted,
  });
  tx(s, "Risk flags: stockout risk · overstock risk · urgency critical / warning / safe.", {
    x: 0.72, y: by + 1.55, w: 5.6, h: 0.5, fontSize: 8.5, color: C.muted,
  });
  rrect(s, { x: 7.25, y: by, w: 5.55, h: 2.3, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "PRICING STRATEGY (RECOMMENDATION ONLY)", { x: 7.42, y: by + 0.12, w: 5.2, h: 0.26, fontSize: 9.5, color: C.blue, bold: true, charSpacing: 1.2 });
  bullets(s, [
    "Rule table over velocity × momentum × stock position",
    "e.g. dead + high stock → −25% clearance · fast + accelerating + low → +5% protect margin",
    "Never auto-applied — surfaced as advice with a minimum floor price",
  ], { x: 7.42, y: by + 0.46, w: 5.2, h: 1.7, size: 9.5, gap: 7 });
  s.addNotes(
    "Reorder math. dailyAvg from corrected demand over the last 3 calendar months; requiredStock = dailyAvg × (leadTime + safetyStockDays); recommended = max(0, required − position), capped, raised to MOQ, rounded up to order multiples. Timeline shows next refill, last safe reorder-by, and estimated stockout date with urgency. Velocity is category-relative; momentum from recent 3-month averages; pricing advice (clearance/markdown/hold/protect) is never auto-applied and respects the margin floor."
  );
}

// ════════════════════════════════════════════════════════════════
// SLIDE 16 — MAKER–CHECKER & RBAC
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 16);
  const y0 = header(s, {
    eyebrow: "PART B · WORKFLOWS",
    title: "Maker–checker approval & RBAC roles",
    subtitle: "Separation of duties — makers submit, checkers approve, treasury funds. Gates are enforced server-side.",
  });
  // Top flow
  spread(s, {
    x0: 0.55, x1: W - 0.55, y: y0 + 0.02, h: 0.75,
    items: [
      { title: "MAKER (client)", sub: "creates · submits · records drafts", fill: C.blueSoft, border: C.blue, tcolor: C.blue, size: 10 },
      { title: "CHECKER", sub: "approves / rejects with comments", fill: C.amberSoft, border: C.amber, tcolor: C.amber, size: 10 },
      { title: "TREASURY / ADMIN", sub: "funds · records payments", fill: C.greenSoft, border: C.green, tcolor: C.green, size: 10 },
    ],
  });
  // Roles table
  const ty = y0 + 1.0;
  mockTable(s, {
    x: 0.55, y: ty, w: 12.25,
    colW: [2.6, 9.65],
    headers: ["Role", "Write access"],
    rows: [
      [{ t: "Client (maker)", b: true }, { t: "Create/edit drafts · submit for review · mark PO sent · record receipt/dispatch drafts · convert after approval" }],
      [{ t: "Checker", b: true, color: C.amber }, { t: "Approve/reject: quotation prices · proforma funding · POs · invoices (approve/reject/dispute) · allow over-receipt / over-dispatch" }],
      [{ t: "Treasury / Admin", b: true, color: C.green }, { t: "Record payments on sales + purchase invoices · fund proformas" }],
      [{ t: "Sales rep", b: true }, { t: "Read-only on POs / SOs / dispatches — can write quotations only" }],
      [{ t: "Admin", b: true, color: C.red }, { t: "Everything" }],
    ],
    rowH: 0.42,
  });
  // Gates strip
  const gy = ty + 0.32 + 5 * 0.42 + 0.14;
  tx(s, "SERVER-SIDE GATES (enforced in models, not just UI)", {
    x: 0.55, y: gy + 0.04, w: 12.2, h: 0.28, fontSize: 9.5, color: C.ink, bold: true,
  });
  const gates = [
    "Quotation → SO: needs price approved", "Proforma → PO/SO: needs funding approved",
    "Invoice issue: needs a confirmed SO", "Purchase invoice: needs approved & sent PO",
    "GRN confirm: sent / partially-received PO", "Dispatch confirm: confirmed / partially-dispatched SO",
    "Over-quantity: admin/checker + explicit flag",
  ];
  gates.forEach((g, i) => {
    const x = 0.55 + (i % 4) * 3.14;
    const y = gy + 0.36 + Math.floor(i / 4) * 0.52;
    pill(s, { x, y, w: 3.0, h: 0.44, text: g, fill: C.bg, color: C.slate, size: 8, bold: false, dashed: true });
  });
  s.addNotes(
    "Maker–checker. Makers create and submit; checkers approve or reject with comments (quotation prices, proforma funding, PO approval, invoice approval/dispute); treasury records payments and funds proformas; sales reps are read-only except quotations; admin can do everything. The critical gates are enforced server-side in the models — UI gating is UX only."
  );
}

// ════════════════════════════════════════════════════════════════
// SLIDE 17 — DUAL-TRACK STATUS MACHINES
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 17);
  const y0 = header(s, {
    eyebrow: "PART B · WORKFLOWS",
    title: "Dual-track status machines",
    subtitle: "Manual statuses (user actions) run alongside derived statuses (recomputed from movements). Quotations and proformas carry two approval tracks at once.",
  });
  const rows17 = [
    { label: "Purchase Order", stps: [
      { t: "draft" }, { t: "approved" }, { t: "sent" }, { t: "partially_received", tone: "done" }, { t: "fully_received", tone: "done" }, { t: "cancelled", tone: "bad" },
    ]},
    { label: "Purchase Invoice", stps: [
      { t: "draft" }, { t: "verified" }, { t: "approved_for_payment" }, { t: "partially_paid", tone: "done" }, { t: "paid", tone: "green" }, { t: "cancelled", tone: "bad" },
    ]},
    { label: "Sales Invoice", stps: [
      { t: "draft" }, { t: "pending (issued)" }, { t: "approved" }, { t: "funded" }, { t: "advanced" }, { t: "paid | partially_paid", tone: "green" }, { t: "cancelled | rejected | disputed", tone: "bad" },
    ]},
    { label: "GRN", stps: [
      { t: "draft" }, { t: "confirmed", tone: "green" }, { t: "cancelled", tone: "bad" },
    ]},
    { label: "Dispatch", stps: [
      { t: "draft" }, { t: "confirmed" }, { t: "partially_delivered", tone: "done" }, { t: "delivered", tone: "green" }, { t: "returned", tone: "warn" }, { t: "cancelled", tone: "bad" },
    ]},
    { label: "Quotation", stps: [
      { t: "draft" }, { t: "sent" }, { t: "accepted | rejected | expired" }, { t: "converted_to_so", tone: "green" },
    ]},
  ];
  rows17.forEach((r, i) => {
    statusRow(s, { y: y0 + 0.05 + i * 0.62, label: r.label, steps: r.stps });
  });
  // Notes
  const ny = y0 + 0.05 + 6 * 0.62 + 0.12;
  rrect(s, { x: 0.55, y: ny, w: 12.25, h: 1.05, fill: { color: C.blueSoft }, line: { color: C.blue, width: 1 }, rectRadius: 0.1 });
  tx(s, "Derived vs manual", {
    x: 0.8, y: ny + 0.1, w: 1.9, h: 0.28, fontSize: 10, color: C.blue, bold: true,
  });
  tx(s, "partially/fully_received, partially/fully_dispatched and delivered are DERIVED from GRNs / dispatches / delivery events — never set by hand. The manual status is stored separately (manualStatus) so revoking all receipts falls back cleanly.", {
    x: 0.8, y: ny + 0.42, w: 11.8, h: 0.55, fontSize: 9.5, color: C.slate,
  });
  tx(s, "Quotation also carries: price approval (pending_review → approved | rejected) and optional debtor approval (pending → approved | rejected). Proforma carries funding (pending_review → approved → funded | rejected).", {
    x: 0.8, y: ny + 0.7, w: 11.8, h: 0.32, fontSize: 9.5, color: C.slate,
  });
  s.addNotes(
    "Status machines. POs, purchase invoices, sales invoices, GRNs, dispatches and quotations each have a status machine. Some statuses are user actions (draft, approved, sent, confirmed, cancelled); others are derived from underlying movements (partially/fully received and dispatched, delivered). Quotations and proformas additionally carry maker–checker and funding approval tracks rendered as separate pills. Derived statuses recompute; manualStatus is stored for clean fallback."
  );
}

// ════════════════════════════════════════════════════════════════
// SLIDE 18 — ADVANCE DEDUCTION & PAYMENTS
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 18);
  const y0 = header(s, {
    eyebrow: "PART B · WORKFLOWS",
    title: "Advance deduction & payment lifecycle",
    subtitle: "Both sales and purchase invoices net off advances — computed server-side, never trusted from the client.",
  });
  // Two cards
  const cy = y0, chh = 2.9;
  rrect(s, { x: 0.55, y: cy, w: 6.0, h: chh, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "SALES SIDE — CUSTOMER", { x: 0.72, y: cy + 0.12, w: 5.6, h: 0.26, fontSize: 10, color: C.blue, bold: true, charSpacing: 1.2 });
  bullets(s, [
    { t: "Linked customer proforma", b: true, sub: "formal id or matching PO number" },
    { t: "Deduction = max(advances received, advancePct × proformaTotal)", b: true },
    { t: "netReceivable = grandTotal − advanceDeducted (never negative)", b: true },
    { t: "Stored amount = net receivable", b: true, sub: "what the customer owes · what funding reads" },
  ], { x: 0.72, y: cy + 0.46, w: 5.6, h: chh - 0.6, size: 9.5, gap: 7 });
  rrect(s, { x: 6.78, y: cy, w: 6.0, h: chh, fill: { color: C.card }, line: { color: C.line, width: 1 }, rectRadius: 0.1 });
  tx(s, "PURCHASE SIDE — SUPPLIER", { x: 6.95, y: cy + 0.12, w: 5.6, h: 0.26, fontSize: 10, color: C.blue, bold: true, charSpacing: 1.2 });
  bullets(s, [
    { t: "Linked supplier proforma", b: true, sub: "formal id or matching PO/proforma number" },
    { t: "Same rule: max(advances paid, advancePct × proformaTotal)", b: true },
    { t: "netPayable = grandTotal − advanceDeducted (never negative)", b: true },
    { t: "Stored amount = net payable", b: true, sub: "what the funding pipeline reads" },
  ], { x: 6.95, y: cy + 0.46, w: 5.6, h: chh - 0.6, size: 9.5, gap: 7 });
  // Banner
  rrect(s, { x: 0.55, y: cy + chh + 0.14, w: 12.25, h: 0.62, fill: { color: C.navy }, rectRadius: 0.1 });
  tx(s, "Computed server-side from recorded advance records — never trusted from the client payload. UI shows “Less advance”, advance history by PO number, and live balance.", {
    x: 0.8, y: cy + chh + 0.14, w: 11.8, h: 0.62, valign: "middle",
    fontSize: 10.5, color: "FFFFFF",
  });
  // Payments lifecycle
  const py = cy + chh + 0.94;
  tx(s, "PAYMENT & NOA LIFECYCLE", { x: 0.55, y: py + 0.02, w: 12.2, h: 0.28, fontSize: 9.5, color: C.ink, bold: true });
  const paySteps = [
    { t: "recordPayment", sub: "accumulates amountReceived" },
    { t: "partially_paid", sub: "derived" },
    { t: "paid", sub: "paidDate · lateDays" },
    { t: "Full reversal", sub: "back to approved_for_payment" },
    { t: "NOA", sub: "not_sent → sent → accepted | rejected | commented" },
  ];
  spread(s, {
    x0: 0.55, x1: W - 0.55, y: py + 0.36, h: 0.78,
    items: paySteps.map((p, i) => ({
      title: p.t, sub: p.sub,
      fill: i === 2 ? C.greenSoft : C.card, border: i === 2 ? C.green : C.line,
      tcolor: i === 2 ? C.green : C.ink, size: 9.5,
    })),
  });
  tx(s, "NOA email carries the invoice PDF + secure token; status only marks sent after a successful send. Paid / cancelled invoices are frozen for content edits.", {
    x: 0.55, y: py + 1.26, w: 12.2, h: 0.3, fontSize: 9, color: C.muted,
  });
  s.addNotes(
    "Advance deduction & payments. Sales invoices deduct the larger of advances actually received and the agreed advance % against a linked customer proforma; purchase invoices mirror this on the supplier side. Both are computed server-side from recorded advances; the stored amount is the net figure the funding pipeline reads. Payments accumulate via recordPayment, deriving partially_paid/paid with paidDate and lateDays; a full reversal returns the invoice to approved_for_payment; NOA is emailed with the PDF and a token, and only marks sent after success."
  );
}

// ════════════════════════════════════════════════════════════════
// SLIDE 19 — CANCELLATION & REVERSAL SEMANTICS
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 19);
  const y0 = header(s, {
    eyebrow: "PART B · WORKFLOWS",
    title: "Cancellation & reversal semantics",
    subtitle: "Every cancellation reverses exactly its own effect — or drops out of the balance entirely.",
  });
  mockTable(s, {
    x: 0.55, y: y0 + 0.05, w: 12.25,
    colW: [3.6, 8.65],
    headers: ["What happened", "What gets reversed"],
    rows: [
      [{ t: "GRN cancelled", b: true, color: C.blue }, { t: "Stock-OUT reversal movements · PO receivedQty revoked · linked purchase invoice detached" }],
      [{ t: "Dispatch cancelled", b: true, color: C.blue }, { t: "Stock-IN reversal movements · SO dispatchedQty revoked" }],
      [{ t: "Return recorded", b: true, color: C.blue }, { t: "Stock credited back IN · SO re-openable for re-dispatch · dispatch closes as returned" }],
      [{ t: "Manual movement cancelled", b: true, color: C.blue }, { t: "No reversal entry — the movement drops out of the balance (cancelled +100 leaves 0, not −100)" }],
      [{ t: "Payment fully reversed", b: true, color: C.blue }, { t: "Invoice returns to approved_for_payment" }],
      [{ t: "Email fails mid-workflow", b: true, color: C.blue }, { t: "Status is NOT rolled back — warning shown, send can be retried (no duplicate emails from double-clicks)" }],
      [{ t: "Double-click / duplicate request", b: true, color: C.blue }, { t: "Atomic conditional update — exactly one wins; the second is a no-op (null = already confirmed)" }],
    ],
    rowH: 0.46,
  });
  const ny = y0 + 0.05 + 0.32 + 7 * 0.46 + 0.16;
  rrect(s, { x: 0.55, y: ny, w: 12.25, h: 0.85, fill: { color: C.amberSoft }, line: { color: C.amber, width: 1 }, rectRadius: 0.1 });
  tx(s, "Why this matters: the ledger stays truthful. A cancelled +100 credit means the balance returns to where it was before — never to −100 — and every reversal is itself an auditable movement. Legacy “received” GRNs are treated as already-credited (confirmed).", {
    x: 0.8, y: ny, w: 11.8, h: 0.85, valign: "middle",
    fontSize: 10, color: C.ink,
  });
  s.addNotes(
    "Reversal semantics. GRN cancel reverses with stock-out movements and revokes PO receipt; dispatch cancel reverses with stock-in movements and revokes SO dispatch; returns credit stock back in and reopen the SO. A cancelled manual movement creates no reversal — it just drops out of the derived balance. Payment reversals restore the prior status; email failures never roll back status; conditional updates make duplicate requests harmless. Everything is auditable."
  );
}

// ════════════════════════════════════════════════════════════════
// SLIDE 20 — INVARIANTS RECAP (dark, closing)
// ════════════════════════════════════════════════════════════════
{
  const s = pptx.addSlide();
  deco(s, 20, { dark: true });
  tx(s, "PART B · RECAP", {
    x: 0.85, y: 0.55, w: 11.6, h: 0.3,
    fontSize: 12, color: C.cyan, bold: true, charSpacing: 3,
  });
  tx(s, "The rules that keep the ledger truthful", {
    x: 0.82, y: 0.9, w: 11.6, h: 0.7,
    fontSize: 30, color: "FFFFFF", bold: true,
  });
  const inv = [
    ["1", "Documents are snapshots, not live links", "line items copy SKU/name/unit/price — later catalogue edits never alter old documents"],
    ["2", "Dual-track statuses where two approvals exist", "quotation: lifecycle + price approval + debtor approval · proforma: lifecycle + funding"],
    ["3", "Derived statuses are recomputed, never set", "partially/fully received & dispatched, delivered — manualStatus kept for clean fallback"],
    ["4", "Concurrency via atomic conditional updates", "status='draft' guard — double-clicks can't double-credit or double-debit stock"],
    ["5", "Cancellation reverses exactly its own effect", "GRN → stock-out + PO revoke · dispatch → stock-in + SO revoke · return → stock-in + reopen"],
    ["6", "Idempotent emails", "“sent” marks status AND emails; email failure never rolls back the status; retry allowed"],
    ["7", "Advance deduction is server-side", "max(paid, agreedPct) from recorded advances — never trusted from the client"],
    ["8", "Duplicate detection", "purchase-invoice numbers unique per supplier (cancelled excluded)"],
    ["9", "Money & numbers discipline", "2dp money · 3dp quantities · GST 0–100 (0/5/12/18/28 presets) · discount 0–100"],
    ["10", "Immutable audit trail", "every workflow action written fire-and-forget with actor, action, target, detail"],
    ["11", "Forecast recompute is async & failure-isolated", "after every stock-affecting event + daily check + startup — one bad SKU can't crash the batch"],
  ];
  inv.forEach((it, i) => {
    const col = i < 6 ? 0 : 1;
    const row = i % 6;
    const x = 0.85 + col * 5.95;
    const y = 1.85 + row * 0.82;
    ellipse(s, { x, y: y + 0.06, w: 0.3, h: 0.3, fill: { color: C.blue }, line: { type: "none" } });
    tx(s, it[0], { x, y: y + 0.02, w: 0.3, h: 0.36, fontSize: 11, color: "FFFFFF", bold: true, align: "center", valign: "middle" });
    tx(s, it[1], { x: x + 0.42, y, w: 5.35, h: 0.28, fontSize: 11.5, color: "FFFFFF", bold: true });
    tx(s, it[2], { x: x + 0.42, y: y + 0.3, w: 5.35, h: 0.5, fontSize: 8.5, color: "8FA3C4" });
  });
  rrect(s, { x: 0.85, y: 6.72, w: 11.6, h: 0.55, fill: { color: C.navySoft }, line: { color: C.navySoft2, width: 1 }, rectRadius: 0.1 });
  tx(s, "Architecture + workflows — extracted from the working Adventra implementation. Every diagram maps 1:1 to code in backend/src and frontend/src.", {
    x: 1.05, y: 6.72, w: 11.2, h: 0.55, valign: "middle",
    fontSize: 10.5, color: "B7C6DE", align: "center",
  });
  s.addNotes(
    "Closing. The eleven invariants that make the ledger truthful: immutable snapshots, dual-track statuses, derived statuses, atomic conditional updates, self-reversing cancellations, idempotent emails, server-side advance math, duplicate detection, number discipline, an immutable audit trail, and async failure-isolated forecast recomputes. Every diagram in this deck maps directly to code."
  );
}

// ── Write file ──────────────────────────────────────────────────
const outPath = require("path").join(__dirname, "..", "Adventra-Architecture-Workflows.pptx");
pptx
  .writeFile({ fileName: outPath })
  .then((fn) => console.log("Saved:", fn))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
