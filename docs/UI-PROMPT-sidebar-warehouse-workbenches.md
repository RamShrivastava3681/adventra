# UI Prompt — Sidebar, Tabs, Warehouse Tab & Workbenches
### Whizunik Command (Adventra Platform) — UI-only, build-ready spec

Use this document as a single copy-paste prompt for an AI UI builder / frontend agent.
It describes **only UI + interaction**. No backend, no API, no business-logic changes.
Source of truth: `frontend/src/components/app-sidebar.tsx`, `frontend/src/routes/app.tsx`,
`frontend/src/components/app-topbar.tsx`, `frontend/src/components/workbench.tsx`,
`frontend/src/routes/app.warehouse-workbench.tsx`, `frontend/src/routes/app.warehouse.tsx`,
`app.sales-workbench.tsx`, `app.procurement-workbench.tsx`, `app.finance-workbench.tsx`.

---

## 1. Global App Shell (layout every page lives in)

```
+----------+--------------------------------------------------+
|          |  Topbar (floating white 64px card, desktop only) |
| Sidebar  +--------------------------------------------------+
| 260px /  |                                                  |
| 68px     |  Main content (Outlet, max-w 1440px, grey bg)    |
|          |                                                  |
+----------+--------------------------------------------------+
```

- **Desktop:** left `aside` is `sticky top-0 h-screen`, white bg, right border `#e5ebf2`,
  shadow `4px 0 24px -12px rgba(10,34,57,0.18)`. Main area is `flex-1 min-w-0`, grey surface.
- **Mobile (<md):** sidebar hidden. Fixed top navbar with hamburger → left `Sheet` drawer
  (`w-280px`) containing the same sidebar (`hideCollapse`, closes on navigate).
  Inline bell + appearance menu on the right.
- **Dark mode:** sidebar/topbar switch to `dark:bg-sidebar` tokens; active blues stay.
  Appearance menu: Light / Dark / System (Sun / Moon / Monitor icons).
- **Content container:** every workbench/page centers at `max-w-[1440px]`, padding
  `px-4 md:px-8`, vertical `py-6 md:py-8`. Page-enter animation on route change.
- **View-as banner:** when impersonating, a banner sits above the topbar on every page.

---

## 2. Sidebar UI — detailed spec

### 2.1 Brand header (top of sidebar)

- Row: `px-4 pt-4 pb-3`, gap-2.
- Left: 36px circle, bg `#0067c2`, white bold `W` (17px).
- Middle (expanded only): `Whizunik` (16px bold, tracking-tight, `#0e1b2c`) over
  `COMMAND` (10px semibold, uppercase, tracking `0.24em`, `#64748b`).
- Right (expanded only): collapse button 28px rounded-lg, `ChevronsLeft` 16px,
  grey → hover `#f1f5f9`. `aria-label="Collapse sidebar"`.
- Collapsed mode: centered expand button (`ChevronsRight`) below the logo row.

### 2.2 Dimensions & scroll

- Expanded: `w-[260px]`. Collapsed: `w-[68px]`. Animated `transition-[width] 200ms linear`.
- Collapse persisted in `localStorage key=whizunik-sidebar-collapsed (1/0)`.
- Nav region: `flex-1 overflow-y-auto px-3 py-2`, items stacked with `gap-2px`.
- Collapsed: icons centered (`justify-center px-0`), labels hidden, tooltips on hover
  (right side). Badge counts become a red dot (`h-2 w-2`, top-right of row).

### 2.3 Item anatomy (single link)

- Height `h-10`, full width, `rounded-[10px]`, `gap-3 px-3`, font `13.5px medium`.
- Icon: 20px, `strokeWidth 1.8`. Inactive icon `#64748b`; active `#0067c2`.
- Inactive: text `#334155`, hover `bg-#f1f5f9 text-#0e1b2c`.
- Active: `bg-#e9f3fe text-#0067c2` + 3px left rail (`absolute left-0 h-5 w-[3px]
  rounded-r-full bg-#0067c2`, vertically centered). `aria-current="page"`.
- Focus: `ring-2 ring-ring`.
- Badges (Checker / My Queue only): red pill `h-5 min-w-5 rounded-full bg-#e5484d
  px-1.5 text-11px bold white`, right-aligned (`ml-auto`). `99+` cap. Zero = hidden.

### 2.4 Group item (only `System` today)

- Parent is a `<button>` (not a link) with chevron-right 16px on the right.
- Active/open parent gets the same blue tint as a single link.
- Click toggles accordion (`aria-expanded`). Chevron rotates 90° when open.
- Open children: indented list `ml-4 mt-1 pl-3 border-l #e5ebf2`, each child
  `rounded-lg px-2.5 py-2 text-13px`, icon 16px + label, same active blue.
- Auto-open: the group containing the active route opens on navigation.
  Collapsing the sidebar closes the accordion.

### 2.5 Display buckets (visual grouping, in this order)

```
MAIN → SALES & CUSTOMERS → PROCUREMENT & SUPPLIERS
→ PRODUCTS & INVENTORY → FINANCE → REPORTS & SYSTEM
```

Bucket mapping:

| Bucket | Sidebar entries |
|---|---|
| MAIN | Dashboard, My Queue, Checker, My Workspace |
| SALES & CUSTOMERS | Sales, Leads, Naughty List, Customers |
| PROCUREMENT & SUPPLIERS | Procurement, Suppliers |
| PRODUCTS & INVENTORY | Product Catalogue, Warehouse Control |
| FINANCE | Finance |
| REPORTS & SYSTEM | Reports, My Reports, System (group) |

Only non-empty buckets render. Order inside each bucket preserves role-filtered order.

### 2.6 Exact sidebar entries, order & icons

Global order: `Dashboard, My Queue, My Workspace, Checker, Finance, Procurement,
Sales, [Leads, Naughty List if sales_rep], Product Catalogue, Warehouse Control,
Reports, [My Reports if reporting_manager], System`.

| Label | Icon | To | Who sees it |
|---|---|---|---|
| Dashboard | LayoutDashboard | /app/dashboard | everyone |
| My Queue | ListTodo | /app/tasks | everyone (staff) |
| My Workspace | Briefcase | /app/workspace | checker, treasury, operations, sales_rep |
| Checker | ClipboardCheck (+red badge) | /app/checker | checker, admin |
| Finance | Wallet | /app/finance-workbench | treasury, operations, admin |
| Procurement | ShoppingCart | /app/procurement-workbench | operations, admin |
| Sales | ShoppingBag | /app/sales-workbench | sales_rep, operations, admin |
| Leads | Users | /app/crm | sales_rep only |
| Naughty List | AlertTriangle | /app/naughty-list | sales_rep (extra); others via workbench deep-link |
| Product Catalogue | Package | /app/products | operations, admin |
| Warehouse Control | Warehouse | /app/warehouse-workbench | operations, admin |
| Reports | BarChart3 | /app/reporting | everyone |
| My Reports | Users | /app/reports | reporting_manager only |
| System (group) | Settings | — | reporting_manager + admin |
| └ Alerts | BellRing | /app/alerts | admin |
| └ Reminders | Mail | /app/reminders | admin |
| └ Operations | Shield | /app/admin | admin |
| └ Invoice template | Palette | /app/template | admin |
| └ Settings | Settings | /app/settings | admin + reporting_manager |

Fallback (unknown role): Dashboard + My Queue only.

### 2.7 Topbar (pairs with sidebar)

- Hidden on mobile. Desktop: `sticky top-3 z-30 px-4`, inner header `h-16 rounded-2xl
  border-#e5ebf2 bg-white px-4` with soft shadow.
- Left: current-page pill (only if label known): `h-9 rounded-[10px] bg-#eef7ff
  px-3 text-13px semibold text-#0067c2`, page icon 16px + label. Hidden below `lg`.
- Right: bell (`/app/alerts`, red `18px` badge, `99+` cap) → appearance menu →
  vertical divider → avatar button (32px circle `bg-#eef7ff`, initial letter bold blue
  + email-prefix name max-110px + chevron) → dropdown: Profile, My Workspace,
  Settings, Sign out (red).

---

## 3. How Tabs Work (two-level tab system — critical)

There are **two distinct tab layers**. Do not merge them.

### 3.1 Level 1 — Sidebar tabs (route navigation)

- Each sidebar entry is a **route link** (`/app/*`). Click = full route change + Outlet swap.
- Active detection: `pathname === to || pathname.startsWith(to + "/")`.
  Detail routes map to pills: `/app/challan/* → Challan`, `/app/invoice-preview/* → Invoice`,
  `/app/note-preview/* → Credit / Debit note`.
- The four workbench sidebar entries are **single links** that open a workbench page:
  `Sales → /app/sales-workbench`, `Procurement → /app/procurement-workbench`,
  `Finance → /app/finance-workbench`, `Warehouse Control → /app/warehouse-workbench`.
- Query preservation: in view-as mode every sidebar link keeps `?viewAsUserId=`.
- Route wall: roles outside their allowed prefixes are redirected
  (checker→/app/checker, treasury→/app/queue, ops→/app/dashboard,
  sales_rep→/app/crm, reporting_manager→/app/dashboard). Admin bypasses.

### 3.2 Level 2 — Workbench in-page tabs (NO route change)

- Inside each `*-workbench` page, directly under the `PageHeader`, is a horizontal
  `NavTab` bar: `flex min-w-max gap-1`, `overflow-x-auto` on small screens.
- Clicking a tab **only switches local state** (`useState`), never navigates.
  Content below swaps via `lazy()` panels + `<Suspense>` skeleton.
- NavTab style: `px-3.5 py-2.5 text-13px medium`, transparent bottom border 2px.
  Active: `border-primary text-primary` + `aria-current="page"`.
  Inactive: `border-transparent text-muted-foreground`, hover `border-border text-foreground`.
- First tab is always `Workbench` (the KPI + work-items overview). Last is always
  `Activity History` (the unified queue filtered to that family).
- Row-level "Open" buttons: if the doc has its own tab (e.g. GRN/dispatch inside
  Warehouse), stay in-page (`setSection("grn")`); else deep-link to the document page.

### 3.3 Level 2b — Warehouse inner pill tabs (inside the Warehouse panel)

- The `Warehouse` panel (`/app/warehouse`) has its **own second tab row**: pill buttons
  `rounded-full border px-3 py-1.5 text-xs uppercase tracking-widest` with icon 14px
  + label + optional count bubble (`bg-primary/15`).
- Active pill: `border-primary bg-primary/10 text-primary`. Inactive: `border-border
  text-muted-foreground`.
- Tabs: `Overview | Pending Sales Order (count) | Ready to dispatch (count) |
  Dispatches (count) | Inventory movements (count)`. See §4 for each.

### 3.4 Reusable primitives (`components/workbench.tsx` — presentation only)

- `WorkbenchHeader({icon,title,subtitle,context,actions})` — bordered header band,
  40px icon tile (`bg-primary-soft`), title 20px semibold + 13px muted subtitle,
  right-aligned context/actions slot (clock chip, avatar).
- `WorkbenchTabs({tabs,active,onChange})` — underline tab row (`.whiz-tabs/.whiz-tab`,
  `role=tablist/tab`, `data-active`).
- `KpiTint({label,value,hint,tint,icon})` — tinted KPI (`blue|amber|red|green`),
  28px number.
- `KpiCard({label,value,sub,icon,tone,onClick})` — white card version used by all
  four workbenches: `rounded-xl border bg-card p-5 shadow-card`, 11px uppercase
  label, 30px number, 12px sub, 36px icon tile top-right. Amber-tinted border for
  attention KPIs. Entire card is a button (click filters / jumps to tab).
- `SectionCard`, `FooterBanner`, `DocAction` — standard section shell, footer strip,
  small doc button.

---

## 4. Warehouse Tab — in detail

### 4.1 Entry point

- Sidebar: `Warehouse Control` (Warehouse icon) → `/app/warehouse-workbench`.
- Page header (`PageHeader`): eyebrow `Warehouse`, title `Warehouse Control`,
  icon Warehouse 20px, description `Monitor inbound receipts, outbound dispatches,
  stock levels and forecasts.`

### 4.2 Workbench tab bar (8 same-page sections)

| Tab | Panel loaded | Contents |
|---|---|---|
| Workbench (default) | inline overview | KPIs + work-items table + sign-off queue (§4.3) |
| Warehouse | `app.warehouse → WarehousePage` | §4.4 (own 5 pill tabs) |
| Forecast | `app.forecast → ForecastPage` | demand forecast table |
| GRN | `app.grn → GrnPage` | goods receipts queue |
| Dispatch | `app.dispatches → DispatchesPageContent` | dispatch notes workspace |
| Stock Allocation | `app.stock-allocation` | allocation board |
| Samples | `app.sample-distribution` | sample queue |
| Activity History | `app.tasks → TasksPage` | warehouse-filtered queue history |

Lazy-load each panel; show `TableSkeleton(rows 6, cols 8)` while loading.

### 4.3 Workbench overview (default tab)

**KPI row** — `grid-cols-1 sm:2 xl:4 gap-4`, each a clickable `KpiCard`:

1. `SOs Awaiting Warehouse` (ClipboardList, amber) — sub `Needs sign-off or hold review` — click → Warehouse section.
2. `GRNs Pending` (PackageCheck, amber) — sub `Awaiting goods receipt` — click → filter work-items to GRNs.
3. `Dispatches In Pipeline` (Truck, blue) — sub `Picking through in-transit` — click → filter to dispatches.
4. `Open Work Items` (FileText, neutral) — sub `GRN + dispatch tasks` — click → All filter.

Loading → 4× `StatSkeleton`. Values are live counts (SOs needing warehouse, draft/pending GRNs, active dispatches, open GRN+dispatch tasks).

**Filter + search row:** pill filters `All | GRNs | Dispatches`
(active `border-primary bg-primary/10 text-primary`) + right-aligned search input
`h-8 w-52 rounded-md border bg-card px-2.5 text-xs`, placeholder
`Search document, customer…` (matches doc number, counterparty, action, status).
Client-side; resets to page 1 on change.

**Main grid** — `lg:grid-cols-4 gap-6`:

- LEFT (span 3) — `Warehouse work items` card + `View all` link → Activity History.
  Sub-caption: `GRNs and dispatches that need action before the next step.`
  Table columns: Document (mono number button + workflow-type caption + red Overdue dot)
  | Counterparty | Value (right, `fmtMoney`) | Current Status (`StatusPill`)
  | Next Step (truncate 220px, full text in title) | Owner (Warehouse/Checker/Treasury/Sales/Procurement)
  | Action (primary button `Review|Record GRN|Pick & Pack|Submit|Dispatch|Follow Up|Open` + `…` menu → Open document / View in My Queue).
  Sorting: overdue → priority (urgent>high>normal>low) → due date → newest.
  Pagination 15/page: `Showing X–Y of Z` + prev/next 28px bordered buttons + `P/N` counter.
  Empty: Warehouse icon, `You're all caught up / No warehouse work currently requires your attention.`
- RIGHT — `Needs warehouse sign-off` card + `Review` link → Warehouse section.
  Top-5 SOs needing warehouse: customer (13px medium) + `SO-number · expected-date` mono,
  red `Xd overdue` chip when late. Empty: `No pending sign-offs`.

### 4.4 Warehouse panel — header + 5 pill tabs

**Panel header** (white, bordered): left 44px icon tile (`border-primary/20 bg-primary/10`,
Warehouse 20px blue) + `Warehouse Workbench` 20px semibold `#0f1f38` + subtitle
`Manage physical stock flow from receiving to dispatch` (13px muted). Right: live clock
chip (`Weekday, Mon D, YYYY · HH:MM`, 12px, updates every 30s) + operator avatar
(36px primary circle, email initial) or `READ-ONLY` outline chip when no write access
(non ops/admin).

**Pill tab row** (`flex flex-wrap gap-2`): Overview (BarChart3) | Pending Sales Order
(ClipboardCheck + pending count) | Ready to dispatch (PackageCheck + orders+invoices count)
| Dispatches (Truck + open count) | Inventory movements (Boxes + total count).

#### TAB 1 — Overview

Two cards (`lg:grid-cols-2`):

- `Live dispatch pipeline`: 6 mini tiles (`grid-2 sm:3`) — Picking | Packing
  (`packed` labelled Packing) | Awaiting Pickup | Dispatched | In Transit | Delivered —
  each: 10px uppercase caption + 24px count (non-cancelled). Footnote:
  `Picking and packing never touch stock — inventory is debited once, when the status moves to Dispatched.`
- `Latest activity`: last 5 dispatches (`number · customer/SO` + pipeline-color pill)
  + last 5 movements (`In/Out · item × qty` + date). Empty: `Nothing has moved yet`.

#### TAB 2 — Pending Sales Order (the sign-off queue)

- Table: Order | Buyer | Ordered (date) | Expected (date) | Value (right, money)
  | Commercial (`StatusPill`: warehouse_pending/checker_pending/confirmed/partially_dispatched)
  | Warehouse (pill: approved green / rejected red / on_hold amber / pending grey)
  | actions (Approve blue + Reject outline, only when `warehouse_pending` + canWrite).
- `Approve` opens the **Verify-stock modal** (not instant):
  - Title `Verify stock — {SO-number}`, sub `{customer} · approval needs every line checked and fully in stock`.
  - Line table: Product (+SKU mono) | Ordered (right) | Pending (right) | In stock
    (right, green; red bold if short) | Verified (checkbox). Header checkbox toggles all.
  - Short lines: red-tinted row + `Short by X — not available`.
  - Blocker banner: red if short (`N lines short — approval blocked until stock arrives`),
    amber if unchecked (`Check all N lines … (k/N verified)`).
  - Notes textarea (`Rack / batch verification notes…`, optional for approve).
  - Footer: Cancel + Reject (sends notes) + Approve (disabled until all checked AND none short).
  - Approve success toast: `Order approved — sent to Checker`. Reject: `Order rejected — returned to Sales review`.
- Footnote: `Warehouse approval sends the order to the Checker. Dispatch notes cannot be created until both approvals are complete.`

#### TAB 3 — Ready to dispatch (two stacked cards)

- Card A `Checker-confirmed orders ready for dispatch`: Order | Buyer | Expected
  | Pending qty (right) | Pending value (right) | blue button `Create & set to picking`
  (Truck icon → `/app/dispatches?createFromSO={id}&initialStatus=picking`).
  Empty: `No orders waiting / Approve orders in Pending Sales Order, then wait for Checker approval.`
- Card B `Approved invoices awaiting dispatch`: Invoice (mono + SO ref) | Customer
  | Amount (right) | Expected dispatch | Days left (`Due today` red / `Nd left` amber ≤3d / `Nd` grey)
  | blue `Create dispatch` (→ `/app/dispatches?createFromInvoice={id}&initialStatus=picking`).
  Footnote: invoice reference is stored on the dispatch and appears in the movement report.

#### TAB 4 — Dispatches (pipeline table)

- Columns: Ref | Order/buyer | Dispatched (date) | Carrier/tracking (inline editor:
  pencil → Carrier + Tracking inputs + Save/Cancel) | Commercial (`StatusPill`)
  | Pipeline (forward-only `<select>`: Picking → Packing → Awaiting Pickup → Dispatched
  → In Transit → Delivered, current + later options only; Delivered rows show a green pill)
  | Cancel/Return (Return for confirmed/partially_delivered/delivered + Cancel; `—` when closed).
- Read-only users see the pipeline as a colored pill instead of the select.
- Selecting `Awaiting Pickup` opens the **transporter/upload modal** (details go to Finance).
  Moving to `Dispatched` debits stock (toast `Moved to Dispatched — inventory debited`).
  Cancel toast: `Dispatch cancelled — stock reversed only if it was dispatched`.
  Return toast: `Return recorded — stock credited back`.
- Pipeline pill tones: Delivered green, Dispatched/In Transit blue, Packing amber, else grey.
- Footnote explains forward-only flow + single debit point + Finance handoff.

#### TAB 5 — Inventory movements

- Table (latest 100, newest first): Date | Item (+SKU) | Direction pill (In green / Out blue)
  | Qty + unit (right) | Warehouse | Status (`StatusPill`: draft/confirmed/cancelled)
  | Linked doc (number or —).
- Footnote: `Showing latest 100 movements. Full history lives under Inventory.`
- Loading → `TableSkeleton`; empty → `No movements yet`.

### 4.5 Warehouse permissions (UI gating)

- `canWrite = admin || operations`. Others see `Read-only` chip, no Approve/Reject,
  no pipeline select, no carrier edit, no Cancel/Return.

---

## 5. Workbenches — shared pattern + per-workbench tabs

### 5.1 The universal workbench recipe (apply to all four)

1. `PageHeader` with `eyebrow` (family name), `title`, icon, one-line description.
2. `NavTab` bar (same-page, underline style, `overflow-x-auto`). Tabs never change the URL.
3. `Workbench` overview tab = KPI cards (4, clickable) + filter pills + compact search
   (+ optional owner/supplier select) + work-items table (Document|Counterparty|Value|
   Current Status|Next Step|Owner|Action + `…` menu) + right-side focus panel
   (sign-off / attention queue, top-5, View-all link) + 15/page pagination.
4. Document tabs = existing pages hosted via `lazy()` + `Suspense` skeleton.
5. `Activity History` tab = same queue component filtered to that family.

Shared table UX: overdue red dot, `StatusPill` for status, truncated Next Step with
tooltip, primary action button with engine-derived label, `… → Open document /
View in My Queue`, skeleton while loading, friendly empty state.

### 5.2 Sales Workbench (`/app/sales-workbench`, ShoppingBag)

- Header: eyebrow `Sales`, title `Sales Workbench` (exact page header copy:
  sales pipeline monitoring).
- Tabs: Workbench | Customers | Sales Orders | Proforma Invoices | Sales Invoices
  | Credit Notes | Activity History.
- KPIs: Awaiting Customer Acceptance | Advance Payments Pending | Invoices Awaiting
  Approval | Ready for Dispatch.
- Family: sales workflow tasks (sales orders, proformas, invoices, credit notes).
- Sales-rep extras stay in the sidebar (Leads, Naughty List) — the workbench replaces
  document tabs, not personal tools.

### 5.3 Procurement Workbench (`/app/procurement-workbench`, ShoppingCart)

- Header: eyebrow `Procurement`, title `Procurement Workbench`.
- Tabs: Workbench | Suppliers | Purchase Orders | Purchase Proforma | Purchase Invoices
  | Activity History.
- KPIs: POs Awaiting Approval | Supplier Invoices Pending | Deliveries Due This Week
  | GRNs Pending.
- Filters: All + family pills, search (document/supplier), supplier select, owner select.

### 5.4 Finance Workbench (`/app/finance-workbench`, Wallet)

- Header: eyebrow `Finance`, title `Finance Workbench` (cash/treasury command).
- Tabs: Workbench | Cash Command | Treasury | Bulk Payments | Sales Orders
  | Sales Invoices | Proforma Invoices | Advances | Purchase Invoices | Dispatch Orders
  | Activity History.
- KPIs: Sales Invoices Awaiting Approval | Purchase Invoices Pending | Open Payments
  | Overdue Invoices.
- Filters: All + family pills, search, owner select. Dispatch Orders tab surfaces the
  transporter details handed off from Warehouse Awaiting Pickup.

### 5.5 Warehouse Workbench (see §4 — full detail above)

- Tabs: Workbench | Warehouse | Forecast | GRN | Dispatch | Stock Allocation
  | Samples | Activity History.
- KPIs: SOs Awaiting Warehouse | GRNs Pending | Dispatches In Pipeline | Open Work Items.

### 5.6 My Workspace (`/app/workspace`, Briefcase — companion, not a workbench)

- Header: `My Workspace / Submit & track your requests`.
- Segmented tab bar (rounded container, active = white card shadow):
  Visits (MapPin) | Travel (Plane) | Expenses (Receipt) | Leave (CalendarDays).
- `New {tab}` dashed button → inline form card → Submit; history list with status pill
  (Pending amber / Approved blue / Rejected red) + delete for pending.
- View-as mode: `Their workspace | Activity overview` segmented switch (read-only list + progress stats).

---

## 6. Visual language tokens (apply everywhere)

- Font: display font for headings/numbers (`.font-display`, `.num` tabular-nums).
- Blues: primary `#0067c2`, soft bg `#e9f3fe` / `#eef7ff`, tile border `primary/20`.
- Ink: headings `#0e1b2c` / `#0f1f38` / `#0f2c4d`, body `#334155`, muted `#64748b/#475569`.
- Danger: `#e5484d`. Borders: `#e5ebf2`. Page bg: `#f5f7fa` (warehouse) / muted surfaces.
- Radii: sidebar rows 10px, cards 12–16px (`rounded-xl`), pills `rounded-full`,
  topbar 16px (`rounded-2xl`).
- Shadows: `shadow-card / shadow-card-hover`, topbar `0 8px 28px -12px rgba(10,34,57,.18)`.
- Status pills: green success, blue primary, amber attention, red destructive/critical,
  grey muted — 10–11px uppercase tracking-widest.
- Icons: Lucide, 20px sidebar / 16px children / 14px pills, stroke 1.8.
- A11y: `aria-current`, `aria-expanded`, `aria-label` on icon buttons, focus rings,
  tooltips for collapsed icons and truncated cells.

---

## 7. Copy-paste builder prompt (use verbatim)

> Build the Whizunik Command app shell: left sidebar 260px (68px collapsed, localStorage
> persisted, tooltips + red-dot badges when collapsed) with brand header (blue W circle +
> Whizunik / COMMAND + collapse chevron), six display buckets (MAIN, SALES & CUSTOMERS,
> PROCUREMENT & SUPPLIERS, PRODUCTS & INVENTORY, FINANCE, REPORTS & SYSTEM), exact entries
> in order Dashboard, My Queue, My Workspace, Checker, Finance, Procurement, Sales,
> [Leads, Naughty List], Product Catalogue, Warehouse Control, Reports, [My Reports],
> System group (Alerts, Reminders, Operations, Invoice template, Settings), active row
> light-blue with left rail, Lucide icons, red count badges on Checker/My Queue.
> Floating 64px white topbar with current-page pill, bell with unread badge, Light/Dark/
> System menu, avatar dropdown (Profile, My Workspace, Settings, Sign out). Mobile:
> hamburger → drawer with same sidebar.
>
> Tabs are two-level: sidebar tabs navigate routes; each Sales/Procurement/Finance/
> Warehouse workbench page has a same-page underline NavTab bar (Workbench overview first,
> Activity History last, no URL change, lazy panels + skeleton). Warehouse Control opens
> the Warehouse Workbench with tabs Workbench, Warehouse, Forecast, GRN, Dispatch, Stock
> Allocation, Samples, Activity History. The Workbench tab shows 4 clickable KPI cards
> (SOs Awaiting Warehouse, GRNs Pending, Dispatches In Pipeline, Open Work Items),
> All/GRNs/Dispatches filter pills + search, a work-items table (Document, Counterparty,
> Value, Current Status, Next Step, Owner, Action + … menu) with 15/page pagination, and
> a Needs-warehouse-sign-off side list. The Warehouse tab has its own pill tabs:
> Overview (6-stage pipeline tiles + latest activity), Pending Sales Order (sign-off
> table + Verify-stock modal with per-line checkboxes, in-stock comparison, short-stock
> block), Ready to dispatch (checker-confirmed orders + approved invoices with days-left
> chips, Create-dispatch buttons), Dispatches (forward-only pipeline select, inline
> carrier/tracking editor, Awaiting-Pickup transporter modal, Cancel/Return), Inventory
> movements (latest-100 table). Read-only users see pills/chips instead of controls.
> Mirror this exact pattern (KPI cards + filter pills + search + work-items table +
> side queue) for the Sales, Procurement and Finance workbenches with their tab sets
> from §5. Style: white cards, 12–16px radii, #0067c2 blues, tabular numbers, Lucide
> icons, dark-mode sidebar tokens, skeleton loaders, friendly empty states.

---

*Generated from live codebase 2026-09-17. UI-only — no workflow/backend changes implied.*
