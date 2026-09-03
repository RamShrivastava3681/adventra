// Converts DEMO-SPEECH.md (project root) → DEMO-SPEECH.html (project root).
// Run with: node scripts/demo-speech-html.mjs   (from the frontend/ folder)
// Adapted from scripts/md2html.mjs with added italic support + A4 print CSS.
import { readFileSync, writeFileSync } from "node:fs";

const md = readFileSync(new URL("../../DEMO-SPEECH.md", import.meta.url), "utf8").replace(/\r\n?/g, "\n");

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^\w\- ]+/g, "")
    .replace(/ /g, "-");
}

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, (_, c) => `<code>${esc(c)}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

const lines = md.split("\n");
const html = [];
let i = 0;
let titleWrapped = false;
let heroParagraphSeen = false;
let inToc = false;

const push = (s) => html.push(s);

while (i < lines.length) {
  const line = lines[i];

  // fenced code block
  if (line.trim().startsWith("```")) {
    const buf = [];
    i++;
    while (i < lines.length && !lines[i].trim().startsWith("```")) {
      buf.push(lines[i]);
      i++;
    }
    i++;
    push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
    continue;
  }

  // table
  if (line.trim().startsWith("|")) {
    const rows = [];
    while (i < lines.length && lines[i].trim().startsWith("|")) {
      rows.push(lines[i].trim());
      i++;
    }
    const parseRow = (r) => r.split("|").slice(1, -1).map((c) => c.trim());
    const header = parseRow(rows[0]);
    const body = rows.slice(2).map(parseRow);
    let t =
      '<div class="table-wrap"><table><thead><tr>' +
      header.map((h) => `<th>${inline(h)}</th>`).join("") +
      "</tr></thead><tbody>";
    for (const r of body) {
      t += "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>";
    }
    t += "</tbody></table></div>";
    push(t);
    continue;
  }

  // heading
  const hm = line.match(/^(#{1,6})\s+(.*)$/);
  if (hm) {
    const level = hm[1].length;
    const text = hm[2];
    const id = slugify(text);

    if (titleWrapped && level >= 2) {
      push("</div>");
      titleWrapped = false;
    }
    if (inToc && id !== "table-of-contents") {
      push("</div>");
      inToc = false;
    }
    if (level === 1 && !titleWrapped) {
      push('<div class="hero"><span class="badge">🎤 Live demo speech · ~10 minutes</span>');
      titleWrapped = true;
    }
    if (id === "table-of-contents") {
      push('<div class="toc">');
      inToc = true;
    }
    push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
    i++;
    continue;
  }

  // blockquote
  if (line.startsWith(">")) {
    const buf = [];
    while (i < lines.length && lines[i].startsWith(">")) {
      buf.push(lines[i].slice(1).trim());
      i++;
    }
    push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
    continue;
  }

  // lists
  if (/^\s*[-*] /.test(line) || /^\s*\d+\. /.test(line)) {
    const ordered = /^\s*\d+\. /.test(line);
    const buf = [];
    while (i < lines.length && (/^\s*[-*] /.test(lines[i]) || /^\s*\d+\. /.test(lines[i]))) {
      buf.push(lines[i].replace(/^\s*[-*] /, "").replace(/^\s*\d+\. /, ""));
      i++;
    }
    const tag = ordered ? "ol" : "ul";
    push(`<${tag}>` + buf.map((li) => `<li>${inline(li)}</li>`).join("") + `</${tag}>`);
    continue;
  }

  // hr
  if (/^\s*---+$/.test(line)) {
    push("<hr/>");
    i++;
    continue;
  }

  // blank
  if (line.trim() === "") {
    i++;
    continue;
  }

  // paragraph
  const buf = [];
  while (
    i < lines.length &&
    lines[i].trim() !== "" &&
    !/^(#{1,6})\s/.test(lines[i]) &&
    !lines[i].trim().startsWith("|") &&
    !lines[i].trim().startsWith(">") &&
    !lines[i].trim().startsWith("```") &&
    !/^\s*[-*] /.test(lines[i]) &&
    !/^\s*\d+\. /.test(lines[i])
  ) {
    buf.push(lines[i]);
    i++;
  }
  push(`<p>${inline(buf.join(" "))}</p>`);
  if (titleWrapped && !heroParagraphSeen) {
    push("</div>");
    heroParagraphSeen = true;
    titleWrapped = false;
  }
}

const css = `
:root {
  --bg: #f6f5f2; --card: #ffffff; --ink: #1d2329; --muted: #5c6670;
  --accent: #0e4f8a; --accent-2: #0066FF; --line: #e3e0d9;
  --code-bg: #f0ede6; --table-head: #0e4f8a; --quote-bg: #eef3fb;
  --quote-line: #0066FF; --radius: 14px;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.62; font-size: 16px;
}
.container { max-width: 900px; margin: 0 auto; padding: 48px 28px 120px; }
h1 { font-size: 2rem; line-height: 1.25; margin: 0 0 6px; letter-spacing: -0.02em; color: #0b1f33; }
h2 {
  font-size: 1.45rem; margin: 52px 0 14px; padding-top: 18px;
  border-top: 2px solid var(--line); color: #0b1f33; letter-spacing: -0.01em;
}
h3 { font-size: 1.12rem; margin: 28px 0 8px; color: var(--accent); }
h4 { font-size: 1rem; margin: 20px 0 6px; }
p { margin: 10px 0; }
a { color: var(--accent-2); text-decoration: none; border-bottom: 1px solid transparent; }
a:hover { border-bottom-color: currentColor; }
strong { color: #0b1f33; }
hr { border: none; border-top: 1px solid var(--line); margin: 38px 0; }
code {
  background: var(--code-bg); border: 1px solid #e2ddd2; border-radius: 6px;
  padding: 1px 6px; font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  font-size: 0.86em; color: #12365e;
}
pre {
  background: #12202e; color: #d6e4f2; border-radius: var(--radius);
  padding: 16px 20px; overflow-x: auto; font-size: 0.88rem; line-height: 1.55;
}
pre code { background: none; border: none; color: inherit; padding: 0; }
table { border-collapse: collapse; width: 100%; font-size: 0.92rem; margin: 14px 0; }
.table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: var(--radius); }
th, td { text-align: left; padding: 9px 14px; border-bottom: 1px solid var(--line); vertical-align: top; }
thead th {
  background: var(--table-head); color: #fff; font-weight: 600;
  font-size: 0.82rem; letter-spacing: 0.02em; white-space: nowrap;
}
thead th:first-child { border-radius: 12px 0 0 0; }
thead th:last-child { border-radius: 0 12px 0 0; }
tbody tr:nth-child(even) { background: #faf9f6; }
tbody tr:hover { background: #eef3fb; }
td code { white-space: nowrap; }
blockquote {
  margin: 18px 0; padding: 14px 18px; background: var(--quote-bg);
  border-left: 4px solid var(--quote-line); border-radius: 0 10px 10px 0;
  color: #1d3a5f; font-size: 1.02rem;
}
blockquote code { background: #dce7f7; border-color: #c4d4ec; color: #12365e; }
ul, ol { padding-left: 26px; }
li { margin: 5px 0; }
.toc {
  background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
  padding: 20px 26px; margin: 26px 0;
}
.toc h2 { border: none; margin: 0 0 10px; padding: 0; font-size: 1.05rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
.toc ol { margin: 0; padding-left: 22px; columns: 2; column-gap: 34px; font-size: 0.92rem; }
.toc li { break-inside: avoid; }
.hero {
  background: linear-gradient(135deg, #0e4f8a, #0066FF); color: #fff;
  border-radius: var(--radius); padding: 26px 30px; margin-bottom: 8px;
}
.hero h1 { color: #fff; }
.hero p, .hero strong { color: #d7e6fa; }
.hero code { background: rgba(255,255,255,0.18); border-color: rgba(255,255,255,0.3); color: #eaffff; }
.badge {
  display: inline-block; background: rgba(255,255,255,0.16); border-radius: 999px;
  padding: 3px 12px; font-size: 0.78rem; letter-spacing: 0.04em; margin-bottom: 10px;
}
footer { margin-top: 70px; padding-top: 18px; border-top: 2px solid var(--line); color: var(--muted); font-size: 0.85rem; }

/* ── Print: one part per A4 page ─────────────────────────────── */
@media print {
  @page { size: A4; margin: 13mm 14mm; }
  body { background: #fff; font-size: 11.5pt; }
  .container { max-width: none; padding: 0; }
  h2 { page-break-before: always; margin-top: 0; }
  h2:first-of-type { page-break-before: auto; }
  .hero, .toc, pre, .table-wrap, blockquote { break-inside: avoid; }
  a { color: inherit; border-bottom: none; }
}
@media (max-width: 720px) {
  .toc ol { columns: 1; }
  body { font-size: 15px; }
  .container { padding: 24px 16px 90px; }
}
`;

const doc = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Whizunik Command — Live Demo Speech</title>
<style>${css}</style>
</head>
<body>
<div class="container">
${html.join("\n")}
<footer>
<p>Whizunik Command demo speech — covers every role, every tab, and the full demand-forecasting engine (14 formula steps).<br/>
Generated from <code>DEMO-SPEECH.md</code> · Numbers in Part 5 are the real output of <code>forecastSKU()</code> in <code>frontend/src/lib/forecast-engine.ts</code>.</p>
</footer>
</div>
</body>
</html>`;

writeFileSync(new URL("../../DEMO-SPEECH.html", import.meta.url), doc, "utf8");
console.log("HTML written: DEMO-SPEECH.html");
