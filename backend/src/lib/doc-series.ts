/**
 * Document number series — ADV-<FY>-<TYPE>-<NNN>.
 *
 * Financial year follows the Indian convention (starts 1 April), so
 * 2026-10-07 and 2027-02-15 both belong to FY "26/27", while 2027-05-01
 * starts "27/28". Each FY restarts its own 001, 002, … sequence.
 */

/** Indian financial-year tag ("26/27") for a YYYY-MM-DD date (or today). */
export function fyTag(dateISO?: string | null): string {
  let y = new Date().getFullYear();
  let m = new Date().getMonth() + 1;
  if (typeof dateISO === "string" && /^\d{4}-\d{2}-\d{2}/.test(dateISO.trim())) {
    y = parseInt(dateISO.slice(0, 4), 10);
    m = parseInt(dateISO.slice(5, 7), 10);
    if (!Number.isFinite(y) || !Number.isFinite(m)) {
      const now = new Date();
      y = now.getFullYear();
      m = now.getMonth() + 1;
    }
  }
  const start = m >= 4 ? y : y - 1;
  return `${String(start).slice(2)}/${String(start + 1).slice(2)}`;
}

/**
 * Next free number in a prefixed series (e.g. prefix "ADV-26/27-SO-" →
 * "ADV-26/27-SO-004"). Scans already-used numbers with the same prefix and
 * continues after the highest trailing number (min. 3 digits: 001, 002, …
 * 010, … 100, …). Numbers from other prefixes / FYs are ignored.
 */
export function nextInSeries(
  prefix: string,
  used: Array<string | null | undefined>,
  width = 3,
): string {
  let max = 0;
  let w = width;
  for (const raw of used) {
    const s = String(raw ?? "").trim();
    if (!s.startsWith(prefix)) continue;
    const m = s.slice(prefix.length).match(/(\d+)\s*$/);
    if (!m) continue;
    const n = parseInt(m[1], 10) || 0;
    if (n > max) {
      max = n;
      w = Math.max(width, m[1].length);
    }
  }
  return `${prefix}${String(max + 1).padStart(w, "0")}`;
}
