import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import {
  PageHeader,
  Card,
  EmptyState,
  fmtMoney,
  fmtDate,
} from "@/components/ledger-ui";
import {
  ClipboardCheck,
  Check,
  X,
  Lock,
  FileMinus,
  FilePlus,
  Eye,
  ListChecks,
  ShoppingBag,
  Package,
  FileText,
  Info,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
} from "lucide-react";
import { TableSkeleton, StatSkeleton } from "@/components/skeletons";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InvoiceDetailModal,
  ProformaDetailModal,
  PurchaseOrderDetailModal,
  SalesOrderDetailModal,
} from "@/components/document-view";

export const Route = createFileRoute("/app/checker")({
  component: CheckerPage,
});

/* ────────────────────────────────────────────────────────────────────────────
 * Field audit (source of truth for what the workbench may display)
 * ---------------------------------------------------------------------------
 * Doc type            | Creator name on row            | Submission timestamp
 * Sales Orders (SO)   | salesperson_name               | created_at
 * Purchase Orders(PO) | buyer_name                     | created_at
 * Sales Invoices (SI) | salesperson_name (goods) / —   | created_at
 * Purchase InvoicesPI | — (client_id only)             | created_at
 * Proformas (PF)      | — (client_id only)             | created_at
 * Credit/Debit Notes  | — (client_id only)             | created_at
 *
 * client_id → name resolution uses the existing admin-only /admin/users
 * endpoint (fetched only when the viewer is an admin). Checkers see direct
 * names where the document stores them; otherwise "—". No backend changes.
 *
 * Approval ageing buckets are computed client-side from created_at:
 *   Due Today = age 0 · This Week = age 1–7 · Overdue = age > 7
 * ──────────────────────────────────────────────────────────────────────── */

type Row = {
  kind: "sale" | "purchase";
  id: string;
  invoice_number: string;
  amount: number;
  po_number?: string | null;
  advance: number;
  net: number;
  issue_date: string | null;
  due_date: string | null;
  party: string;
  client_id?: string | null;
  noa_status?: string;
  noa_comments?: string | null;
  /** Raw document from the list endpoint — powers the read-only View modal. */
  raw: any;
};

/* ── Workbench nav tabs (in-page filter state — no new routes) ── */
type TabKey =
  | "queue"
  | "so"
  | "po"
  | "pi"
  | "si"
  | "approved"
  | "returned"
  | "history";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "queue", label: "Approval Queue" },
  { key: "so", label: "Sales Orders" },
  { key: "po", label: "Purchase Orders" },
  { key: "pi", label: "Purchase Invoices" },
  { key: "si", label: "Sales Invoices" },
  { key: "approved", label: "Approved" },
  { key: "returned", label: "Returned" },
  { key: "history", label: "Approval History" },
];

type ItemType =
  | "sales_order"
  | "purchase_order"
  | "purchase_invoice"
  | "sales_invoice"
  | "proforma"
  | "note";

const TYPE_LABEL: Record<ItemType, string> = {
  sales_order: "Sales Order",
  purchase_order: "Purchase Order",
  purchase_invoice: "Purchase Invoice",
  sales_invoice: "Sales Invoice",
  proforma: "Proforma",
  note: "Credit / Debit Note",
};

const TAB_TO_TYPE: Partial<Record<TabKey, ItemType>> = {
  so: "sales_order",
  po: "purchase_order",
  pi: "purchase_invoice",
  si: "sales_invoice",
};

/** Whole-day age of an ISO timestamp (local midnights, never negative). */
function ageDaysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (isNaN(t.getTime())) return null;
  const a = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  const now = new Date();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.max(0, Math.floor((b - a) / 86400000));
}

/* ── Unified queue row: one shape across all six document types ── */
type QueueItem = {
  key: string;
  type: ItemType;
  docNumber: string;
  createdBy: string | null;
  value: number;
  valueSub?: string | null;
  submittedOn: string | null;
  summary: string;
  ageDays: number | null;
  selfCreated: boolean;
  /* existing read-only review experience for this row (modal opener) */
  onReview: (() => void) | null;
  /* existing decision actions — wired verbatim to the current mutations */
  onApprove: () => void;
  onReject: () => void;
  approveLabel: string;
  rejectLabel: string;
  approvePending: boolean;
  noaStatus?: string | null;
  noaComments?: string | null;
};

function CheckerPage() {
  const { isAdmin, isChecker, user } = useAuth();
  const canReview = isAdmin || isChecker;
  const qc = useQueryClient();

  const [tab, setTab] = useState<TabKey>("queue");
  const [queueFilter, setQueueFilter] = useState<"all" | "proforma" | "note">("all");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;

  const [viewInv, setViewInv] = useState<{ kind: "sale" | "purchase"; raw: any } | null>(null);
  const [approveFor, setApproveFor] = useState<{ row: Row; utr: string; amount: string } | null>(null);
  const [viewPf, setViewPf] = useState<any | null>(null);
  const [viewPo, setViewPo] = useState<any | null>(null);
  const [viewSo, setViewSo] = useState<any | null>(null);

  /* ── Pending queues — queries unchanged from the original checker page ── */

  const salesQ = useQuery({
    queryKey: ["checker-sales"],
    queryFn: async () => {
      const data = await api.invoices.list();
      return data.filter((i: any) => i.status === "pending");
    },
  });

  const purchasesQ = useQuery({
    queryKey: ["checker-purchases"],
    queryFn: async () => {
      const data = await api.purchaseInvoices.list();
      // New lifecycle: creator marks the invoice Verified; the checker approves
      // it for payment. Legacy "pending" invoices still surface here too.
      return data.filter((p: any) => ["verified", "pending"].includes(p.status));
    },
  });

  const reviewSale = useMutation({
    mutationFn: async ({
      id,
      decision,
      utr_reference,
      payment_amount,
    }: {
      id: string;
      decision: "approved" | "rejected";
      utr_reference?: string;
      payment_amount?: number;
    }) => {
      await api.invoices.update(id, {
        status: decision,
        utr_reference: utr_reference || null,
        payment_amount: payment_amount || null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checker-sales"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["queue-sales"] });
      toast.success("Decision recorded");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const reviewPurchase = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "approved" | "disputed" }) => {
      // Approve → Approved for Payment (enters the AP queue). Dispute → back
      // to draft so the creator can fix it.
      await api.purchaseInvoices.update(id, {
        status: decision === "approved" ? "approved_for_payment" : "draft",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checker-purchases"] });
      qc.invalidateQueries({ queryKey: ["purchase_invoices"] });
      qc.invalidateQueries({ queryKey: ["queue-purchases"] });
      toast.success("Decision recorded");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // Proforma advances awaiting checker approval
  const proformasQ = useQuery({
    queryKey: ["checker-proformas"],
    queryFn: async () => {
      const data = await api.purchaseOrders.list();
      // Never surface closed proformas for review (expired/cancelled/converted keep
      // the old proforma_status, but the document lifecycle has ended).
      return data.filter(
        (p: any) =>
          !["cancelled", "expired", "converted_to_po"].includes(p.status) &&
          (p.proforma_status === "pending_review" ||
            (p.status === "proforma" && p.proforma_status === "draft")),
      );
    },
  });

  const reviewProforma = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "approved" | "rejected" }) => {
      await api.purchaseOrders.update(id, {
        proforma_status: decision,
        proforma_reviewed_by: user!.id,
        proforma_reviewed_at: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checker-proformas"] });
      qc.invalidateQueries({ queryKey: ["proformas"] });
      qc.invalidateQueries({ queryKey: ["queue-proformas"] });
      toast.success("Proforma decision recorded");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // Resolve counterparty names for proformas (debtor for sales, supplier/vendor for purchase)
  const partiesQ = useQuery({
    queryKey: ["checker-parties"],
    queryFn: async () => {
      const [debtors, suppliers, vendors] = await Promise.all([
        api.debtors.list(),
        api.suppliers.list(),
        api.vendors.list(),
      ]);
      const map: Record<string, string> = {};
      for (const d of debtors) map[d.id] = d.name;
      for (const s of suppliers) map[s.id] = s.company_name ?? s.companyName ?? s.name;
      for (const v of vendors) map[v.id] = v.name;
      return map;
    },
  });
  const partyMap = partiesQ.data ?? {};
  const pfParty = (p: any) =>
    (p.side === "sales" ? partyMap[p.debtor_id] : partyMap[p.vendor_id]) ?? "—";

  const notesQ = useQuery({
    queryKey: ["checker-notes"],
    queryFn: async () => {
      const data = await api.creditDebitNotes.list();
      return data.filter((n: any) => n.status === "pending" || n.status === "issued");
    },
  });

  const reviewNote = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "approved" | "rejected" }) => {
      await api.creditDebitNotes.update(id, { status: decision });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checker-notes"] });
      qc.invalidateQueries({ queryKey: ["credit-debit-notes"] });
      qc.invalidateQueries({ queryKey: ["queue-notes"] });
      toast.success("Note decision recorded");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // Goods purchase orders awaiting the checker's approval.
  const posQ = useQuery({
    queryKey: ["checker-pos"],
    queryFn: async () => {
      const data = await api.goodsPurchaseOrders.list();
      return data.filter((p: any) => p.status === "pending_review");
    },
  });

  const reviewPO = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: "approved" | "draft" }) => {
      // Approve → Approved (can then be sent to the supplier). Reject → back
      // to draft so the maker can fix and resubmit.
      await api.goodsPurchaseOrders.update(id, {
        status: decision,
        reviewed_by: user!.id,
        reviewed_at: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checker-pos"] });
      qc.invalidateQueries({ queryKey: ["goods-pos"] });
      qc.invalidateQueries({ queryKey: ["goods-pos-for-pi"] });
      qc.invalidateQueries({ queryKey: ["goods-pos-for-convert"] });
      toast.success("Purchase order decision recorded");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // Goods sales orders awaiting the checker's approval.
  const sosQ = useQuery({
    queryKey: ["checker-sos"],
    queryFn: async () => {
      const data = await api.goodsSalesOrders.list();
      return data.filter((s: any) => ["warehouse_approved", "checker_pending"].includes(s.status));
    },
  });

  const reviewSO = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "approve" | "reject" }) => {
      await api.goodsSalesOrders.checkerApprove(id, action);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checker-sos"] });
      qc.invalidateQueries({ queryKey: ["goods-sos"] });
      qc.invalidateQueries({ queryKey: ["pf-sales-orders"] });
      qc.invalidateQueries({ queryKey: ["invoices-by-so"] });
      toast.success("Sales order decision recorded");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  /* ── Creator-name resolution (admin only — /admin/users is admin-gated) ── */
  const usersQ = useQuery({
    queryKey: ["checker-users"],
    enabled: !!isAdmin,
    retry: false,
    queryFn: async () => {
      try {
        return await api.admin.users();
      } catch {
        return [];
      }
    },
  });
  const userMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const u of usersQ.data ?? []) {
      m[u.id] = u.contact_name ?? u.contactName ?? u.name ?? u.email;
    }
    return m;
  }, [usersQ.data]);
  const creatorFor = (direct: string | null | undefined, clientId?: string | null) =>
    direct ?? (isAdmin ? userMap[clientId ?? ""] : null) ?? null;

  /* ── PO → open advance lookup (verbatim from the original page) ── */
  const salePos = Array.from(
    new Set(((salesQ.data ?? []) as any[]).map((i) => (i.po_number ?? "").trim()).filter(Boolean)),
  );
  const purPos = Array.from(
    new Set(
      ((purchasesQ.data ?? []) as any[]).map((p) => (p.po_number ?? "").trim()).filter(Boolean),
    ),
  );

  const advLookupQ = useQuery({
    queryKey: ["checker-advances", salePos, purPos],
    enabled: salePos.length > 0 || purPos.length > 0,
    queryFn: async () => {
      const map: Record<string, number> = {}; // key: `${side}::${po}`
      const fetchSide = async (side: "sales" | "purchase", pos: string[]) => {
        if (!pos.length) return;
        const allOrders = await api.purchaseOrders.list();
        const poRows = allOrders.filter((o: any) => o.side === side && pos.includes(o.po_number));
        const ids = poRows.map((r: any) => r.id);
        const idToPo = new Map<string, string>(poRows.map((r: any) => [r.id, r.po_number]));
        if (!ids.length) return;
        const allAdvances = await api.advances.list();
        const advs = allAdvances.filter(
          (a: any) =>
            a.side === side &&
            ids.includes(a.purchaseOrderId ?? a.purchase_order_id) &&
            a.status !== "refunded",
        );
        for (const a of advs as any[]) {
          const po = idToPo.get(a.purchase_order_id);
          if (!po) continue;
          map[`${side}::${po}`] = (map[`${side}::${po}`] ?? 0) + Number(a.amount);
        }
      };
      await Promise.all([fetchSide("sales", salePos), fetchSide("purchase", purPos)]);
      return map;
    },
  });
  const advMap = advLookupQ.data ?? {};

  const advFor = (side: "sales" | "purchase", po?: string | null) => {
    const k = po ? `${side}::${po.trim()}` : "";
    return k ? Number(advMap[k] ?? 0) : 0;
  };

  /* ── Invoice rows (kept for the UTR approve modal + sales NOA context) ── */
  const invoiceRows: Row[] = [
    ...((salesQ.data ?? []) as Array<Record<string, any>>).map((i): Row => {
      // Goods invoices now store the net amount (grand total − advances) and
      // the deducted advance. Fall back to the legacy PO-number lookup for
      // invoices created before those fields existed.
      const storedAdv = Number(i.advance_deducted ?? 0);
      const adv = storedAdv > 0 ? storedAdv : advFor("sales", i.po_number);
      const amt = Number(i.amount ?? i.grand_total ?? 0);
      const net = storedAdv > 0 ? amt : Math.max(0, amt - adv);
      return {
        kind: "sale",
        id: i.id,
        invoice_number: i.invoice_number,
        amount: amt,
        po_number: i.po_number,
        advance: adv,
        net,
        issue_date: i.issue_date,
        due_date: i.due_date,
        party: partyMap[i.debtor_id] ?? i.debtor?.name ?? "—",
        client_id: i.client_id,
        noa_status: i.noa_status,
        noa_comments: i.noa_comments,
        raw: i,
      };
    }),
    ...((purchasesQ.data ?? []) as Array<Record<string, any>>).map((p): Row => {
      const storedAdv = Number(p.advance_deducted ?? 0);
      const adv = storedAdv > 0 ? storedAdv : advFor("purchase", p.po_number);
      const amt = Number(p.amount ?? p.grand_total ?? 0);
      const net = storedAdv > 0 ? amt : Math.max(0, amt - adv);
      return {
        kind: "purchase",
        id: p.id,
        invoice_number: p.invoice_number,
        amount: amt,
        po_number: p.goods_po_number ?? p.po_number,
        advance: adv,
        net,
        issue_date: p.issue_date,
        due_date: p.due_date,
        party: p.supplier_name ?? partyMap[p.vendor_id] ?? p.vendor?.name ?? "—",
        client_id: p.client_id,
        raw: p,
      };
    }),
  ];
  /* ── Unified queue across all six document types ── */
  const items: QueueItem[] = useMemo(() => {
    const out: QueueItem[] = [];

    // Sales orders
    for (const s of (sosQ.data ?? []) as any[]) {
      const lineCount = (s.lines ?? []).reduce(
        (n: number, l: any) => n + (Number(l.ordered_qty) || 0),
        0,
      );
      out.push({
        key: `so-${s.id}`,
        type: "sales_order",
        docNumber: s.so_number,
        createdBy: creatorFor(s.salesperson_name, s.client_id),
        value: Number(s.grand_total) || 0,
        submittedOn: s.created_at,
        summary: `Customer order · ${lineCount.toLocaleString()} units${s.customer_name ? ` · ${s.customer_name}` : ""}`,
        ageDays: ageDaysSince(s.created_at),
        selfCreated: s.client_id === user?.id && !isAdmin,
        onReview: () => setViewSo(s),
        onApprove: () => reviewSO.mutate({ id: s.id, action: "approve" }),
        onReject: () => reviewSO.mutate({ id: s.id, action: "reject" }),
        approveLabel: "Approve",
        rejectLabel: s.status === "checker_pending" ? "Reject" : "Reject",
        approvePending: reviewSO.isPending,
      });
    }

    // Purchase orders
    for (const p of (posQ.data ?? []) as any[]) {
      const lineCount = (p.lines ?? []).reduce(
        (n: number, l: any) => n + (Number(l.ordered_qty) || 0),
        0,
      );
      out.push({
        key: `po-${p.id}`,
        type: "purchase_order",
        docNumber: p.po_number,
        createdBy: creatorFor(p.buyer_name, p.client_id),
        value: Number(p.grand_total) || 0,
        submittedOn: p.created_at,
        summary: `Supplier order · ${lineCount.toLocaleString()} units${p.supplier_name ? ` · ${p.supplier_name}` : ""}`,
        ageDays: ageDaysSince(p.created_at),
        selfCreated: p.client_id === user?.id && !isAdmin,
        onReview: () => setViewPo(p),
        onApprove: () => reviewPO.mutate({ id: p.id, decision: "approved" }),
        onReject: () => reviewPO.mutate({ id: p.id, decision: "draft" }),
        approveLabel: "Approve",
        rejectLabel: "Reject",
        approvePending: reviewPO.isPending,
      });
    }

    // Purchase invoices
    for (const p of (purchasesQ.data ?? []) as any[]) {
      out.push({
        key: `pi-${p.id}`,
        type: "purchase_invoice",
        docNumber: p.invoice_number,
        createdBy: creatorFor(null, p.client_id),
        value: Number(p.amount ?? p.grand_total ?? 0),
        submittedOn: p.created_at,
        summary: `Supplier invoice${p.supplier_name ? ` from ${p.supplier_name}` : ""}`,
        ageDays: ageDaysSince(p.created_at),
        selfCreated: p.client_id === user?.id && !isAdmin,
        onReview: () =>
          setViewInv({ kind: "purchase", raw: invoiceRows.find((r) => r.id === p.id)?.raw ?? p }),
        onApprove: () => reviewPurchase.mutate({ id: p.id, decision: "approved" }),
        onReject: () => reviewPurchase.mutate({ id: p.id, decision: "disputed" }),
        approveLabel: "Approve",
        rejectLabel: "Dispute",
        approvePending: reviewPurchase.isPending,
      });
    }

    // Sales invoices
    for (const r of invoiceRows.filter((x) => x.kind === "sale")) {
      out.push({
        key: `si-${r.id}`,
        type: "sales_invoice",
        docNumber: r.invoice_number,
        createdBy: creatorFor(r.raw?.salesperson_name, r.client_id),
        value: r.amount,
        valueSub: r.advance > 0 ? `Net ${fmtMoney(r.net)}` : null,
        submittedOn: r.raw?.created_at,
        summary: `Invoice for ${r.party}`,
        ageDays: ageDaysSince(r.raw?.created_at),
        selfCreated: r.client_id === user?.id && !isAdmin,
        onReview: () => setViewInv({ kind: "sale", raw: r.raw }),
        onApprove: () => setApproveFor({ row: r, utr: "", amount: String(r.amount) }),
        onReject: () => reviewSale.mutate({ id: r.id, decision: "rejected" }),
        approveLabel: "Approve",
        rejectLabel: "Reject",
        approvePending: reviewSale.isPending,
        noaStatus: r.noa_status,
        noaComments: r.noa_comments,
      });
    }

    // Proforma advances
    for (const p of (proformasQ.data ?? []) as any[]) {
      out.push({
        key: `pf-${p.id}`,
        type: "proforma",
        docNumber: p.proforma_number ?? "—",
        createdBy: creatorFor(null, p.client_id),
        value: Number(p.amount) || 0,
        submittedOn: p.created_at,
        summary: `${p.side === "sales" ? "Sales" : "Purchase"} proforma advance · ${pfParty(p)}`,
        ageDays: ageDaysSince(p.created_at),
        selfCreated: p.client_id === user?.id && !isAdmin,
        onReview: () => setViewPf(p),
        onApprove: () => reviewProforma.mutate({ id: p.id, decision: "approved" }),
        onReject: () => reviewProforma.mutate({ id: p.id, decision: "rejected" }),
        approveLabel: "Approve",
        rejectLabel: "Reject",
        approvePending: reviewProforma.isPending,
      });
    }

    // Credit / debit notes
    for (const n of (notesQ.data ?? []) as any[]) {
      const linkedRaw = n.invoice ?? n.purchase ?? null;
      out.push({
        key: `note-${n.id}`,
        type: "note",
        docNumber: n.note_number,
        createdBy: creatorFor(null, n.client_id),
        value: Number(n.amount) || 0,
        submittedOn: n.created_at,
        summary: `${n.kind === "credit" ? "Credit" : "Debit"} note${n.reason ? ` · ${n.reason}` : ""}`,
        ageDays: ageDaysSince(n.created_at),
        selfCreated: n.client_id === user?.id && !isAdmin,
        // Notes have no dedicated detail modal — reuse the existing linked
        // invoice modal when one is attached; otherwise no review view.
        onReview: linkedRaw
          ? () => setViewInv({ kind: n.invoice ? "sale" : "purchase", raw: linkedRaw })
          : null,
        onApprove: () => reviewNote.mutate({ id: n.id, decision: "approved" }),
        onReject: () => reviewNote.mutate({ id: n.id, decision: "rejected" }),
        approveLabel: "Approve",
        rejectLabel: "Reject",
        approvePending: reviewNote.isPending,
      });
    }

    // Oldest first — overdue items naturally rise to the top.
    out.sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sosQ.data,
    posQ.data,
    purchasesQ.data,
    salesQ.data,
    proformasQ.data,
    notesQ.data,
    partyMap,
    userMap,
    isAdmin,
    user?.id,
    invoiceRows,
  ]);

  /* ── Past decisions by this checker (verbatim from the original page) ── */
  const historyQ = useQuery({
    queryKey: ["checker-history", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const [sales, purchases, proformas, pos, sos, notes] = await Promise.all([
        api.invoices.list(),
        api.purchaseInvoices.list(),
        api.purchaseOrders.list(),
        api.goodsPurchaseOrders.list(),
        api.goodsSalesOrders.list(),
        api.creditDebitNotes.list(),
      ]);
      const uid = user!.id;
      const rows: Array<{
        kind: string;
        doc_number: string;
        party: string;
        action: string;
        detail: string | null;
        reviewed_at: string;
        side: "sale" | "purchase" | "proforma" | "po" | "so" | "note";
      }> = [];
      for (const i of sales) {
        const s = i as any;
        if (s.reviewed_by === uid && s.reviewed_at) {
          rows.push({
            kind: "Invoice",
            doc_number: s.invoice_number,
            party: partyMap[s.debtor_id] ?? "—",
            action: s.status === "approved" ? "Approved" : "Rejected",
            detail: (s.utr_reference || s.payment_amount) ? `UTR: ${s.utr_reference || "—"}${s.payment_amount != null ? ` · ${fmtMoney(s.payment_amount)}` : ""}` : null,
            reviewed_at: s.reviewed_at,
            side: "sale",
          });
        }
      }
      for (const p of purchases) {
        if ((p as any).reviewed_by === uid && (p as any).reviewed_at) {
          rows.push({
            kind: "Purchase Invoice",
            doc_number: p.invoice_number,
            party: p.supplier_name ?? "—",
            action: (p as any).status === "approved_for_payment" ? "Approved" : "Disputed",
            detail: null,
            reviewed_at: (p as any).reviewed_at,
            side: "purchase",
          });
        }
      }
      for (const pf of proformas) {
        if ((pf as any).proforma_reviewed_by === uid && (pf as any).proforma_reviewed_at) {
          rows.push({
            kind: "Proforma",
            doc_number: pf.proforma_number ?? "—",
            party: pfParty(pf),
            action: (pf as any).proforma_status === "approved" ? "Approved" : "Rejected",
            detail: null,
            reviewed_at: (pf as any).proforma_reviewed_at,
            side: "proforma",
          });
        }
      }
      for (const po of pos) {
        if ((po as any).reviewed_by === uid && (po as any).reviewed_at) {
          rows.push({
            kind: "Purchase Order",
            doc_number: po.po_number,
            party: po.supplier_name ?? "—",
            action: (po as any).status === "approved" ? "Approved" : "Rejected",
            detail: null,
            reviewed_at: (po as any).reviewed_at,
            side: "po",
          });
        }
      }
      for (const so of sos) {
        if ((so as any).reviewed_by === uid && (so as any).reviewed_at) {
          rows.push({
            kind: "Sales Order",
            doc_number: so.so_number,
            party: so.customer_name ?? "—",
            action: (so as any).status === "confirmed" ? "Approved" : "Rejected",
            detail: null,
            reviewed_at: (so as any).reviewed_at,
            side: "so",
          });
        }
      }
      for (const n of notes) {
        if ((n as any).reviewed_by === uid && (n as any).reviewed_at) {
          rows.push({
            kind: n.kind === "credit" ? "Credit Note" : "Debit Note",
            doc_number: n.note_number,
            party: n.counterparty ?? "—",
            action: (n as any).status === "approved" ? "Approved" : "Rejected",
            detail: null,
            reviewed_at: (n as any).reviewed_at,
            side: n.kind === "credit" ? "sale" : "purchase",
          });
        }
      }
      rows.sort(
        (a, b) =>
          new Date(b.reviewed_at).getTime() - new Date(a.reviewed_at).getTime(),
      );
      return rows;
    },
  });

  /* ── Derived: counts, filtering, ageing buckets, pagination ── */
  const countSO = (sosQ.data ?? []).length;
  const countPO = (posQ.data ?? []).length;
  const countInv = (salesQ.data ?? []).length + (purchasesQ.data ?? []).length;
  const countTotal =
    countSO + countPO + countInv + (proformasQ.data ?? []).length + (notesQ.data ?? []).length;

  const isHistoryTab = tab === "approved" || tab === "returned" || tab === "history";

  const visibleItems = useMemo(() => {
    let list = items;
    const t = TAB_TO_TYPE[tab];
    if (t) list = list.filter((i) => i.type === t);
    else if (tab === "queue") {
      if (queueFilter === "proforma") list = list.filter((i) => i.type === "proforma");
      else if (queueFilter === "note") list = list.filter((i) => i.type === "note");
      // "all" keeps every type, matching the original All / Sales / Purchases
      // filter behavior (proformas & notes remain part of the full queue).
    }
    return list;
  }, [items, tab, queueFilter]);

  const buckets = useMemo(() => {
    let overdue = 0;
    let today = 0;
    let week = 0;
    for (const i of items) {
      if (i.ageDays == null) continue;
      if (i.ageDays > 7) overdue++;
      else if (i.ageDays === 0) today++;
      else week++;
    }
    return { overdue, today, week };
  }, [items]);

  const totalPages = Math.max(1, Math.ceil(visibleItems.length / PAGE_SIZE));
  useEffect(() => {
    setPage(1);
  }, [tab, queueFilter]);
  const safePage = Math.min(page, totalPages);
  const pageItems = visibleItems.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const historyFiltered = useMemo(() => {
    const h = historyQ.data ?? [];
    if (tab === "approved") return h.filter((x) => x.action === "Approved" || x.action === "Confirmed");
    if (tab === "returned") return h.filter((x) => x.action !== "Approved" && x.action !== "Confirmed");
    return h;
  }, [historyQ.data, tab]);

  const queueLoading =
    salesQ.isLoading ||
    purchasesQ.isLoading ||
    proformasQ.isLoading ||
    posQ.isLoading ||
    sosQ.isLoading ||
    notesQ.isLoading;

  const todayLabel = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  /* ── Ageing pill on the Document cell — color only where it means priority ── */
  const AgeDot = ({ days }: { days: number | null }) => {
    if (days == null) return null;
    if (days > 7)
      return (
        <span
          className="inline-flex items-center gap-1 text-[10px] font-medium text-destructive"
          title="Waiting more than 7 days"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
          {days}d
        </span>
      );
    if (days >= 4)
      return (
        <span
          className="inline-flex items-center gap-1 text-[10px] font-medium text-sem-attention"
          title="Waiting 4–7 days"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-sem-attention" />
          {days}d
        </span>
      );
    return null;
  };

  return (
    <div>
      <PageHeader
        eyebrow="Checker"
        title="Checker Workbench"
        icon={<ClipboardCheck className="h-5 w-5" />}
        description="Review and approve documents"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!isHistoryTab && tab === "queue" && (
              <Select value={queueFilter} onValueChange={(v) => setQueueFilter(v as any)}>
                <SelectTrigger className="h-9 w-[170px] bg-card text-sm">
                  <SelectValue placeholder="Queue" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All document types</SelectItem>
                  <SelectItem value="proforma">Proforma advances</SelectItem>
                  <SelectItem value="note">Credit / Debit notes</SelectItem>
                </SelectContent>
              </Select>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5" />
              {todayLabel}
            </span>
          </div>
        }
      />

      {/* ── Checker navigation ── */}
      <div className="border-b border-border bg-background">
        <div className="mx-auto w-full max-w-[1440px] overflow-x-auto px-4 md:px-8">
          <nav className="flex min-w-max gap-1" aria-label="Checker sections">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                aria-current={tab === t.key ? "page" : undefined}
                className={`whitespace-nowrap border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors ${
                  tab === t.key
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                }`}
              >
                {t.label}
                {t.key === "queue" && countTotal > 0 && (
                  <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                    {countTotal}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-6 md:px-8 md:py-8">
        {/* ── KPI cards ── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {queueLoading ? (
            <>
              <StatSkeleton />
              <StatSkeleton />
              <StatSkeleton />
              <StatSkeleton />
            </>
          ) : (
            <>
              <KpiCard
                label="Total Awaiting Approval"
                value={countTotal}
                sub="Across all document types"
                icon={<ListChecks className="h-[18px] w-[18px]" />}
              />
              <KpiCard
                label="Sales Orders"
                value={countSO}
                sub="Awaiting your review"
                icon={<ShoppingBag className="h-[18px] w-[18px]" />}
              />
              <KpiCard
                label="Purchase Orders"
                value={countPO}
                sub="Awaiting your review"
                icon={<Package className="h-[18px] w-[18px]" />}
                tone={countPO > 0 ? "amber" : "neutral"}
              />
              <KpiCard
                label="Invoices"
                value={countInv}
                sub="Awaiting your review"
                icon={<FileText className="h-[18px] w-[18px]" />}
              />
            </>
          )}
        </div>

        {/* ── Main content: decisions table (75%) + ageing (25%) ── */}
        <div className="grid gap-6 lg:grid-cols-4">
          {/* LEFT — Items awaiting your decision */}
          <Card
            className="lg:col-span-3"
            title={isHistoryTab ? "Your decisions" : "Items awaiting your decision"}
            action={
              !isHistoryTab && visibleItems.length > 0 ? (
                <span className="text-xs text-muted-foreground">
                  {visibleItems.length} pending
                </span>
              ) : undefined
            }
          >
            {isHistoryTab ? (
              /* ── Approved / Returned / History — existing review history ── */
              historyQ.isLoading ? (
                <TableSkeleton rows={5} cols={6} />
              ) : historyFiltered.length === 0 ? (
                <EmptyState
                  icon={<ClipboardCheck className="h-6 w-6" />}
                  title={tab === "returned" ? "No returned documents" : tab === "approved" ? "No approvals yet" : "No past approvals yet"}
                  description="Decisions you record will appear here."
                />
              ) : (
                <div className="-mx-5 overflow-x-auto table-wrap">
                  <table className="table-premium w-full text-sm">
                    <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr className="border-b border-border bg-muted/40">
                        <th className="px-4 py-2 text-left font-medium">Document</th>
                        <th className="px-4 py-2 text-left font-medium">Type</th>
                        <th className="px-4 py-2 text-left font-medium">Counterparty</th>
                        <th className="px-4 py-2 text-left font-medium">Decision</th>
                        <th className="px-4 py-2 text-left font-medium hidden md:table-cell">Details</th>
                        <th className="px-4 py-2 text-left font-medium">Reviewed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyFiltered.slice(0, 50).map((h: any, idx: number) => (
                        <tr key={idx} className="border-b border-border/60 hover:bg-muted/30">
                          <td className="px-4 py-2.5 font-mono text-xs font-medium">{h.doc_number}</td>
                          <td className="px-4 py-2.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                            {h.kind}
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">{h.party}</td>
                          <td className="px-4 py-2.5">
                            <span
                              className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                                h.action === "Approved" || h.action === "Confirmed"
                                  ? "text-sem-success"
                                  : "text-destructive"
                              }`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  h.action === "Approved" || h.action === "Confirmed"
                                    ? "bg-sem-success"
                                    : "bg-destructive"
                                }`}
                              />
                              {h.action}
                            </span>
                          </td>
                          {h.detail ? (
                            <td className="px-4 py-2.5 text-xs text-muted-foreground hidden md:table-cell">
                              {h.detail}
                            </td>
                          ) : (
                            <td className="px-4 py-2.5 hidden md:table-cell">—</td>
                          )}
                          <td className="px-4 py-2.5 text-sm text-muted-foreground">
                            {fmtDate(h.reviewed_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : queueLoading ? (
              <TableSkeleton rows={6} cols={6} />
            ) : visibleItems.length === 0 ? (
              <EmptyState
                icon={<ClipboardCheck className="h-6 w-6" />}
                title="You're all caught up"
                description="There's nothing waiting for your approval."
              />
            ) : (
              <>
                <div className="-mx-5 overflow-x-auto table-wrap">
                  <table className="table-premium w-full text-sm">
                    <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr className="border-b border-border bg-muted/40">
                        <th className="px-4 py-2 text-left font-medium">Document</th>
                        <th className="px-4 py-2 text-left font-medium">Created By</th>
                        <th className="px-4 py-2 text-right font-medium">Value</th>
                        <th className="px-4 py-2 text-left font-medium">Submitted On</th>
                        <th className="px-4 py-2 text-left font-medium">Summary</th>
                        <th className="px-4 py-2 text-right font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageItems.map((it) => (
                        <tr
                          key={it.key}
                          className="border-b border-border/60 transition-colors hover:bg-muted/30"
                        >
                          {/* Document */}
                          <td className="px-4 py-2.5">
                            <button
                              onClick={it.onReview ?? undefined}
                              className={`text-left font-mono text-[13px] font-semibold tracking-tight text-foreground ${
                                it.onReview ? "hover:text-primary" : "cursor-default"
                              }`}
                              title={it.onReview ? "Open document details" : TYPE_LABEL[it.type]}
                            >
                              {it.docNumber}
                            </button>
                            <div className="mt-0.5 flex items-center gap-2">
                              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                {TYPE_LABEL[it.type]}
                              </span>
                              <AgeDot days={it.ageDays} />
                            </div>
                            {it.type === "sales_invoice" && it.noaStatus && (
                              <NoaPill status={it.noaStatus} />
                            )}
                          </td>

                          {/* Created By */}
                          <td className="px-4 py-2.5 text-[13px] text-muted-foreground">
                            {it.createdBy ?? "—"}
                          </td>

                          {/* Value */}
                          <td className="px-4 py-2.5 text-right">
                            <span className="num text-[13px] font-medium">{fmtMoney(it.value)}</span>
                            {it.valueSub && (
                              <div className="text-[10px] text-muted-foreground">{it.valueSub}</div>
                            )}
                          </td>

                          {/* Submitted On */}
                          <td className="px-4 py-2.5 text-[13px] text-muted-foreground">
                            {fmtDate(it.submittedOn)}
                          </td>

                          {/* Summary */}
                          <td
                            className="max-w-[240px] truncate px-4 py-2.5 text-[13px] text-muted-foreground"
                            title={it.summary}
                          >
                            {it.summary}
                          </td>

                          {/* Action */}
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            {!canReview ? (
                              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                                <Lock className="h-3 w-3" /> Checker only
                              </span>
                            ) : it.selfCreated ? (
                              <span
                                className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground"
                                title="Segregation of duties: you cannot review a document you created"
                              >
                                <Lock className="h-3 w-3" /> Self-created
                              </span>
                            ) : (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  onClick={it.onReview ?? it.onApprove}
                                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-sm transition-all hover:-translate-y-px hover:shadow-md disabled:opacity-60"
                                  title={
                                    it.onReview
                                      ? "Review document details"
                                      : "No detail view exists for this document — approve directly"
                                  }
                                >
                                  Review
                                </button>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button
                                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                                      aria-label="More actions"
                                    >
                                      <MoreHorizontal className="h-4 w-4" />
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-52">
                                    {it.onReview && (
                                      <DropdownMenuItem onClick={it.onReview}>
                                        <Eye className="h-3.5 w-3.5" /> Open details
                                      </DropdownMenuItem>
                                    )}
                                    {it.onReview && <DropdownMenuSeparator />}
                                    <DropdownMenuItem onClick={it.onApprove} disabled={it.approvePending}>
                                      <Check className="h-3.5 w-3.5 text-sem-success" />
                                      {it.approveLabel}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={it.onReject} disabled={it.approvePending}>
                                      <X className="h-3.5 w-3.5 text-destructive" />
                                      {it.rejectLabel}
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination — client-side, mirrors existing list-page patterns */}
                {totalPages > 1 && (
                  <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      Showing {(safePage - 1) * PAGE_SIZE + 1}–
                      {Math.min(safePage * PAGE_SIZE, visibleItems.length)} of {visibleItems.length}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={safePage <= 1}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
                        aria-label="Previous page"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      <span className="px-1 font-medium">
                        {safePage} / {totalPages}
                      </span>
                      <button
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={safePage >= totalPages}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
                        aria-label="Next page"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>

          {/* RIGHT — Approval ageing + guidance */}
          <div className="space-y-6">
            {!isHistoryTab && (
              <Card title="Approval ageing">
                {queueLoading ? (
                  <div className="space-y-3">
                    <StatSkeleton />
                    <StatSkeleton />
                    <StatSkeleton />
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <AgeRow
                      label="Overdue"
                      count={buckets.overdue}
                      sub="Past due date"
                      tone="red"
                    />
                    <AgeRow
                      label="Due Today"
                      count={buckets.today}
                      sub="Needs attention"
                      tone="amber"
                    />
                    <AgeRow
                      label="This Week"
                      count={buckets.week}
                      sub="Due in 2–7 days"
                      tone="blue"
                    />
                  </div>
                )}
              </Card>
            )}

            {isHistoryTab && (
              <Card title="Recent decisions">
                {historyQ.isLoading ? (
                  <TableSkeleton rows={3} cols={1} />
                ) : (historyQ.data ?? []).length === 0 ? (
                  <div className="py-4 text-center text-sm text-muted-foreground">
                    No decisions yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {(historyQ.data ?? []).slice(0, 8).map((h: any, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border/70 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-mono text-xs font-medium">{h.doc_number}</div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            {h.kind} · {fmtDate(h.reviewed_at)}
                          </div>
                        </div>
                        <span
                          className={`shrink-0 text-[11px] font-semibold ${
                            h.action === "Approved" || h.action === "Confirmed"
                              ? "text-sem-success"
                              : "text-destructive"
                          }`}
                        >
                          {h.action}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}

            {/* Helper information card */}
            <div className="flex items-start gap-2.5 rounded-xl border border-primary/15 bg-primary-soft/50 p-4">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p className="text-xs leading-relaxed text-muted-foreground">
                Open a document to review details, then Approve or Return from within the
                document view.
              </p>
            </div>
          </div>
        </div>

        {/* ── Existing detail modals (unchanged) ── */}
        {viewInv && (
          <InvoiceDetailModal
            invoice={viewInv.raw}
            kind={viewInv.kind}
            onClose={() => setViewInv(null)}
          />
        )}
        {viewPf && <ProformaDetailModal pf={viewPf} onClose={() => setViewPf(null)} />}
        {viewPo && <PurchaseOrderDetailModal po={viewPo} onClose={() => setViewPo(null)} />}
        {viewSo && <SalesOrderDetailModal so={viewSo} onClose={() => setViewSo(null)} />}

        {approveFor && (
          <ApproveSaleModal
            row={approveFor.row}
            onClose={() => setApproveFor(null)}
            onSubmit={(vals) => {
              reviewSale.mutate(
                {
                  id: approveFor.row.id,
                  decision: "approved",
                  utr_reference: vals.utr_reference,
                  payment_amount: vals.payment_amount,
                },
                { onSuccess: () => setApproveFor(null) },
              );
            }}
          />
        )}
      </div>
    </div>
  );
}

/* ── KPI card — white, thin border, icon tile, big number ── */
function KpiCard({
  label,
  value,
  sub,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: number;
  sub: string;
  icon: React.ReactNode;
  tone?: "neutral" | "amber";
}) {
  return (
    <div
      className={`rounded-xl border bg-card p-5 shadow-card transition-shadow duration-200 hover:shadow-card-hover ${
        tone === "amber" ? "border-sem-attention/30" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
            tone === "amber"
              ? "border-sem-attention/25 bg-sem-attention/10 text-sem-attention"
              : "border-primary/20 bg-primary-soft text-primary"
          }`}
        >
          {icon}
        </div>
      </div>
      <div className="num mt-2 text-3xl font-semibold tracking-tight text-foreground">
        {value}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

/* ── Ageing row — prominent number, colored left accent ── */
function AgeRow({
  label,
  count,
  sub,
  tone,
}: {
  label: string;
  count: number;
  sub: string;
  tone: "red" | "amber" | "blue";
}) {
  const cls = {
    red: "border-l-destructive text-destructive",
    amber: "border-l-sem-attention text-sem-attention",
    blue: "border-l-primary text-primary",
  }[tone];
  return (
    <div className={`rounded-lg border border-border border-l-[3px] ${cls} bg-background/60 px-4 py-3`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-foreground">{label}</span>
        <span className="num text-2xl font-semibold tracking-tight">{count}</span>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}

function ApproveSaleModal({
  row,
  onClose,
  onSubmit,
}: {
  row: Row;
  onClose: () => void;
  onSubmit: (v: { utr_reference: string; payment_amount?: number }) => void;
}) {
  const [utr, setUtr] = useState(row.raw?.utr_reference ?? "");
  const [amount, setAmount] = useState(
    String(row.raw?.payment_amount ?? row.amount),
  );
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-vault"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 font-display text-lg">
          Approve & record payment · {row.invoice_number}
        </h3>
        <div className="space-y-3 text-sm">
          <div className="rounded-md border border-border bg-background/40 p-3 text-xs text-muted-foreground space-y-1">
            <div>Counterparty: <span className="text-foreground">{row.party}</span></div>
            <div>Gross amount: <span className="num text-foreground">{fmtMoney(row.amount)}</span></div>
            <div>Due date: <span className="text-muted-foreground">{fmtDate(row.due_date)}</span></div>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
              UTR / payment reference (optional)
            </span>
            <input
              maxLength={60}
              value={utr}
              onChange={(e) => setUtr(e.target.value)}
              className="w-full rounded-md border border-border bg-background p-2"
              placeholder="Bank transfer reference…"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
              Payment amount (optional)
            </span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-md border border-border bg-background p-2"
              placeholder="Full or partial amount received…"
            />
          </label>
          {amount && Number(amount) > 0 && (
            <div className="text-[10px] text-muted-foreground">
              {Number(amount) >= row.amount
                ? "Full payment recorded"
                : `Partial · ${fmtMoney(row.amount - Number(amount))} still outstanding`}
            </div>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            onClick={() =>
              onSubmit({
                utr_reference: utr.trim() || undefined,
                payment_amount: amount ? Number(amount) : undefined,
              })
            }
            className="inline-flex items-center gap-2 rounded-[10px] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:-translate-y-px hover:shadow-md"
          >
            <Check className="h-3.5 w-3.5" />
            Approve & record
          </button>
        </div>
      </div>
    </div>
  );
}

function NoaPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    not_sent: { label: "NOA not sent", cls: "border-border text-muted-foreground" },
    sent: { label: "NOA awaiting reply", cls: "border-sem-attention/50 text-sem-attention" },
    accepted: { label: "NOA accepted", cls: "border-sem-success/50 text-sem-success" },
    rejected: { label: "NOA rejected", cls: "border-destructive/50 text-destructive" },
    commented: { label: "NOA commented", cls: "border-primary/50 text-primary" },
  };
  const v = map[status] ?? map.not_sent;
  return (
    <span
      className={`mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-wider ${v.cls}`}
    >
      {v.label}
    </span>
  );
}
