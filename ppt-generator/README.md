# Deck generator

Generates three decks (in the project root):

- `Adventra-Platform-Walkthrough.pptx` — a 12-slide product walkthrough, matching the
  prompt in `../PPT-PROMPT.md` (`generate.cjs`).
- `Adventra-Architecture-Workflows.pptx` — a 20-slide technical deck of **architecture &
  workflow diagrams**, drawn from `../TECH-STACK-AND-QUESTIONS.md` and
  `../COMPLETE-WORKFLOW-GUIDE.md` (`generate-diagrams.cjs`).
- `whizunik-booklet-premium.pptx` — the WhizUnik premium booklet (12 slides),
  redesigned with a light ivory/gold editorial system across every page: navy ink
  serif headlines (Georgia) + Segoe UI body on ivory paper, browser-chrome
  screenshot frames with a gold spine, a light-theme Working Capital mockup, a
  4-step Connected Activity process slide, and a navy closing band on the
  Executive-Care page (`generate-whizunik.cjs`).

## Regenerate

```bash
cd ppt-generator
npm install              # first time only
npm run generate         # product walkthrough deck
npm run generate:diagrams # architecture & workflow diagrams deck
npm run generate:whizunik # WhizUnik premium booklet
```

Output: `../Adventra-Platform-Walkthrough.pptx`, `../Adventra-Architecture-Workflows.pptx`,
`../whizunik-booklet-premium.pptx`

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
- `generate-whizunik.cjs` — the WhizUnik booklet. Source screenshots live in
  `assets/whizunik/` (extracted from the original deck). Product pages are built
  by the shared `productPage` + `screenCard` helpers; slide 7's light-theme screen
  is drawn entirely from shapes. Change the palette in the `C` object or swap a
  screenshot by editing the `screenCard(...)` call on that slide.

## Editing tips

- All coordinates are inches; slide size is 13.333 × 7.5 in (16:9).
- Palette lives in the `C` object at the top of `generate.cjs`.
- Keep shapes above the footer band (y ≈ 7.08) so page numbers stay visible.
