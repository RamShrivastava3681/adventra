const fs = require("fs");
const p = "src/routes/app.proformas.tsx";
let s = fs.readFileSync(p, "utf8");

// Cut a function declaration: find the body opening brace (the first "{" that
// appears AFTER the parameter-list parens are balanced), then brace-match it.
function cutFn(src, name) {
  const marker = "function " + name;
  const start = src.indexOf(marker);
  if (start === -1) throw new Error(name + " not found");
  let parenDepth = 0, bodyStart = -1;
  for (let i = src.indexOf("(", start); i < src.length; i++) {
    const c = src[i];
    if (c === "(") parenDepth++;
    else if (c === ")") {
      parenDepth--;
      if (parenDepth === 0) { bodyStart = src.indexOf("{", i); break; }
    }
  }
  if (bodyStart === -1) throw new Error(name + " body start not found");
  let depth = 0, end = -1;
  for (let i = bodyStart; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) throw new Error(name + " body end not found");
  while (end < src.length && (src[end] === "\n" || src[end] === "\r")) {
    const nx = src[end + 1];
    end++;
    if (nx !== "\n" && nx !== "\r") break;
  }
  return src.slice(0, start).trimEnd() + "\n" + src.slice(end).replace(/^\n+/, "\n");
}

// Fix leftover fragments from the previous bad cut (partial ConvertModal /
// FundModal remains starting with ": {" type annotations on their own line).
function cutFragment(src, fromMarker, toMarker) {
  const a = src.indexOf(fromMarker);
  if (a === -1) return src;
  const b = src.indexOf(toMarker, a);
  if (b === -1) throw new Error("fragment end not found for " + fromMarker);
  return src.slice(0, a).trimEnd() + "\n" + src.slice(b).replace(/^\n+/, "\n");
}

// Remove remaining mangled fragments of ConvertModal/FundModal.
s = cutFragment(s, "// \u2500\u2500\u2500 Convert to PO modal", "\nfunction ");
s = cutFragment(s, ": { pf: PF; userId: string; onClose: () => void }) {", "\nfunction ");

fs.writeFileSync(p, s);
console.log("fragments cleaned");
