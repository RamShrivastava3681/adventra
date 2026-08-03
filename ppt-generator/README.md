# Adventra deck generator

Generates `Adventra-Platform-Walkthrough.pptx` (in the project root) — a 12-slide
walkthrough of the Adventra platform, matching the prompt in `../PPT-PROMPT.md`.

## Regenerate

```bash
cd ppt-generator
npm install      # first time only
npm run generate # or: node generate.cjs
```

Output: `../Adventra-Platform-Walkthrough.pptx`

## Structure

- `generate.cjs` — the whole deck: palette, layout helpers (`header`, `bullets`,
  `statTile`, `pill`, `hbar`, `mockTable`, `chip`), and one block per slide.
- Slide order: 1 Title · 2 Getting in · 3 Dashboard · 4 Sales & invoicing ·
  5 Procurement & costs · 6 Counterparties & credit · 7 Approval, funding & team
  workflow · 8 Product catalog ★ · 9 Inventory / stock ledger ★ ·
  10 Demand forecasting & reorder ★ · 11 Accounting & statements ·
  12 Monitoring, ops & administration.
- Slides 8–10 are the catalog / inventory / forecasting showcase.
- Every slide carries speaker notes (`addNotes`).

## Editing tips

- All coordinates are inches; slide size is 13.333 × 7.5 in (16:9).
- Palette lives in the `C` object at the top of `generate.cjs`.
- Keep shapes above the footer band (y ≈ 7.08) so page numbers stay visible.
