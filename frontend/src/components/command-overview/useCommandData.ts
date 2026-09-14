import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api-client";
import { daysBetween } from "@/components/ledger-ui";

/** Read either camelCase or snake_case keys from backend payloads. */
export function pick(obj: any, ...keys: string[]): any {
  if (!obj) return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

export function num(v: any): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function parseYMD(s?: string | null): number {
  if (!s) return Infinity;
  const t = Date.parse(String(s).slice(0, 10));
  return isNaN(t) ? Infinity : t;
}

export type AreaKey = "Sales" | "Procurement" | "Warehouse" | "Finance" | "Checker";

export interface PriorityRow {
  id: string;
  area: AreaKey;
  item: string;
  itemSub?: string;
  owner: string;
  nextStep: string;
  targetDate: string | null;
  overdue: boolean;
  approaching: boolean;
  to: string;
}

export interface InventoryAlert {
  id: string;
  sku: string;
  name: string;
  stock: number;
  reorderLevel: number | null;
  forecastNote: string;
  status: "Out of Stock" | "Low Stock" | "Reorder Soon";
  severity: "critical" | "attention" | "warn";
}

export interface OpAlert {
  id: string;
  area: string;
  issue: string;
  detail?: string;
  owner: string;
  priority: "Critical" | "High" | "Medium" | "Info";
  targetDate: string | null;
  overdue: boolean;
  to: string;
}

const DOC_PATH: Record<string, string> = {
  sales_order: "/app/sales-orders",
  sales_invoice: "/app/invoices",
  proforma: "/app/proformas",
  purchase_order: "/app/purchase-orders",
  purchase_invoice: "/app/purchases",
  payment: "/app/queue",
  grn: "/app/grn",
  dispatch: "/app/dispatches",
};

const TASK_AREA: Record<string, AreaKey> = {
  sales_order: "Sales",
  sales_invoice: "Sales",
  proforma: "Sales",
  purchase_order: "Procurement",
  purchase_invoice: "Procurement",
  payment: "Finance",
  grn: "Warehouse",
  dispatch: "Warehouse",
};

function taskDocLabel(t: any): string {
  const n = t.doc_number ?? t.docNumber ?? null;
  const type = String(t.doc_type ?? t.docType ?? "");
  const pretty = type.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
  return n ? `${pretty} ${n}` : pretty || "Document";
}

/**
 * Central data hook for the Command Overview.
 * Every number derives from existing backend endpoints — no invented data.
 * Queries reuse the same cache keys/intervals as their source pages.
 */
export function useCommandData() {
  const cashAccountsQ = useQuery({
    queryKey: ["cmd-cash-accounts"],
    queryFn: () => api.cashFlow.accounts.list(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const cashSummaryQ = useQuery({
    queryKey: ["cmd-cash-summary"],
    queryFn: () => api.cashFlow.summary(),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
  const cashForecastQ = useQuery({
    queryKey: ["cmd-cash-forecast"],
    queryFn: () => api.cashFlow.forecast.get("weekly", "with_commitments"),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const invoicesQ = useQuery({
    queryKey: ["cmd-invoices"],
    queryFn: () => api.invoices.list("all"),
    staleTime: 30_000,
  });
  const purchasesQ = useQuery({
    queryKey: ["cmd-purchases"],
    queryFn: () => api.purchaseInvoices.list("all"),
    staleTime: 30_000,
  });
  const debtorsQ = useQuery({
    queryKey: ["cmd-debtors"],
    queryFn: () => api.debtors.list(),
    staleTime: 60_000,
  });
  const suppliersQ = useQuery({
    queryKey: ["cmd-suppliers"],
    queryFn: () =>
      Promise.all([api.suppliers.list(), api.vendors.list()]).then(([s, v]) => [...s, ...v]),
    staleTime: 60_000,
  });

  const salesOrdersQ = useQuery({
    queryKey: ["cmd-sales-orders"],
    queryFn: () => api.goodsSalesOrders.list(),
    staleTime: 60_000,
  });
  const purchaseOrdersQ = useQuery({
    queryKey: ["cmd-purchase-orders"],
    queryFn: () => api.goodsPurchaseOrders.list(),
    staleTime: 60_000,
  });
  const dispatchesQ = useQuery({
    queryKey: ["cmd-dispatches"],
    queryFn: () => api.goodsDispatches.list(),
    staleTime: 60_000,
  });
  const receiptsQ = useQuery({
    queryKey: ["cmd-receipts"],
    queryFn: () => api.goodsReceipts.list(),
    staleTime: 60_000,
  });
  const tasksQ = useQuery({
    queryKey: ["cmd-tasks-open"],
    queryFn: () => api.workflowTasks.list({ status: "open" }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const alertsQ = useQuery({
    queryKey: ["cmd-alerts"],
    queryFn: () => api.alerts.list(),
    staleTime: 30_000,
  });

  const productsQ = useQuery({
    queryKey: ["cmd-products"],
    queryFn: () => api.products.list(),
    staleTime: 60_000,
  });
  const movementsQ = useQuery({
    queryKey: ["cmd-movements"],
    queryFn: () => api.stockMovements.list(),
    staleTime: 60_000,
  });
  const forecastVarsQ = useQuery({
    queryKey: ["cmd-forecast-vars"],
    queryFn: () => api.forecastVariables.list(),
    staleTime: 60_000,
  });

  const loading =
    invoicesQ.isLoading ||
    purchasesQ.isLoading ||
    cashAccountsQ.isLoading ||
    cashSummaryQ.isLoading;

  // ── Available cash (same math as Cash Command Centre) ──
  const availableCash = useMemo(() => {
    const accounts = cashAccountsQ.data ?? [];
    if (accounts.length > 0) {
      return accounts
        .filter((a: any) => {
          if (a.status && String(a.status).toLowerCase() !== "active") return false;
          const t = String(pick(a, "accountType", "account_type", "type") ?? "BANK").toUpperCase();
          return t === "BANK" || t === "CASH";
        })
        .reduce((sum: number, a: any) => {
          const bal = num(pick(a, "currentBalance", "current_balance", "balance", "amount"));
          const restricted = num(pick(a, "restrictedBalance", "restricted_balance", "restricted"));
          const availRaw = pick(a, "availableForOperations", "available_for_operations");
          const avail = availRaw !== undefined ? num(availRaw) : bal - restricted;
          return sum + avail;
        }, 0);
    }
    return num(pick(cashSummaryQ.data, "currentAvailableCash", "current_available_cash"));
  }, [cashAccountsQ.data, cashSummaryQ.data]);

  // ── Receivables / Payables ──
  const receivables = useMemo(() => {
    const list = (invoicesQ.data ?? []) as any[];
    const open = list.filter((i) => i.status !== "paid" && i.status !== "rejected");
    const isOverdue = (i: any) =>
      i.status === "overdue" ||
      (!!i.due_date &&
        i.status !== "paid" &&
        i.status !== "rejected" &&
        daysBetween(i.due_date) > 0);
    const overdue = open.filter(isOverdue);
    const dueSoon = open.filter((i) => {
      if (!i.due_date || isOverdue(i)) return false;
      const d = daysBetween(i.due_date);
      return d <= 0 && d >= -30;
    });
    return {
      total: open.reduce((s, i) => s + num(i.amount), 0),
      count: open.length,
      dueSoonCount: dueSoon.length,
      dueSoonTotal: dueSoon.reduce((s, i) => s + num(i.amount), 0),
      overdueCount: overdue.length,
      overdueTotal: overdue.reduce((s, i) => s + num(i.amount), 0),
      overdue,
      open,
    };
  }, [invoicesQ.data]);

  const payables = useMemo(() => {
    const list = (purchasesQ.data ?? []) as any[];
    const open = list.filter(
      (p: any) => !["paid", "rejected", "cancelled"].includes(String(p.status)),
    );
    const isOverdue = (p: any) =>
      String(p.status) === "overdue" ||
      (!!p.due_date &&
        !["paid", "rejected", "cancelled"].includes(String(p.status)) &&
        daysBetween(p.due_date) > 0);
    const overdue = open.filter(isOverdue);
    const dueSoon = open.filter((p: any) => {
      if (!p.due_date || isOverdue(p)) return false;
      const d = daysBetween(p.due_date);
      return d <= 0 && d >= -30;
    });
    return {
      total: open.reduce((s, p: any) => s + num(p.amount), 0),
      count: open.length,
      dueSoonCount: dueSoon.length,
      dueSoonTotal: dueSoon.reduce((s, p: any) => s + num(p.amount), 0),
      overdueCount: overdue.length,
      overdueTotal: overdue.reduce((s, p: any) => s + num(p.amount), 0),
      overdue,
      open,
    };
  }, [purchasesQ.data]);

  const debtorName = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of (debtorsQ.data ?? []) as any[]) map.set(d.id, d.name ?? d.id);
    return (id?: string | null) => (id ? (map.get(id) ?? "—") : "—");
  }, [debtorsQ.data]);

  const supplierName = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of (suppliersQ.data ?? []) as any[]) {
      map.set(s.id, s.company_name ?? s.companyName ?? s.name ?? s.id);
    }
    return (id?: string | null) => (id ? (map.get(id) ?? "—") : "—");
  }, [suppliersQ.data]);

  // ── Cross-functional priorities (real workflow tasks first) ──
  const priorities = useMemo<PriorityRow[]>(() => {
    const rows: PriorityRow[] = [];
    for (const t of (tasksQ.data ?? []) as any[]) {
      const docType = String(t.doc_type ?? t.docType ?? "");
      const area: AreaKey = TASK_AREA[docType] ?? "Finance";
      // Checker-owned review tasks surface under Checker.
      const ownerRole = String(t.owner_role ?? t.ownerRole ?? "");
      const finalArea: AreaKey =
        /checker/i.test(ownerRole) ||
        (/review|approval/i.test(String(t.required_action ?? "")) && area !== "Warehouse")
          ? /checker/i.test(ownerRole)
            ? "Checker"
            : area
          : area;
      const due = (t.due_date ?? t.dueDate ?? null) as string | null;
      const od = !!due && daysBetween(due) > 0;
      const approaching = !!due && !od && daysBetween(due) >= -3;
      rows.push({
        id: String(t.id),
        area: finalArea,
        item: taskDocLabel(t),
        itemSub: String(t.counterparty ?? t.required_action ?? "").slice(0, 80) || undefined,
        owner: ownerRole
          ? ownerRole.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
          : "Operations",
        nextStep: String(t.required_action ?? t.requiredAction ?? "Review document"),
        targetDate: due,
        overdue: od || String(t.priority) === "urgent",
        approaching,
        to: DOC_PATH[docType] ?? "/app/tasks",
      });
    }
    // Supplement with genuinely overdue receivables when the task queue is thin.
    if (rows.length < 4) {
      for (const i of receivables.overdue.slice(0, 3)) {
        rows.push({
          id: `recv-${i.id}`,
          area: "Finance",
          item: `Overdue invoice ${i.invoice_number ?? ""}`.trim(),
          itemSub: debtorName(i.debtor_id),
          owner: "Treasury",
          nextStep: "Follow up with customer",
          targetDate: i.due_date ?? null,
          overdue: true,
          approaching: false,
          to: "/app/invoices",
        });
      }
    }
    // Warehouse holds / delayed GRNs supplement.
    if (rows.length < 6) {
      for (const d of ((dispatchesQ.data ?? []) as any[])
        .filter((x: any) =>
          ["on_hold", "hold"].includes(String(x.status ?? x.shipping_status ?? "").toLowerCase()),
        )
        .slice(0, 2)) {
        rows.push({
          id: `disp-${d.id}`,
          area: "Warehouse",
          item: `Dispatch ${pick(d, "dispatchNumber", "dispatch_number", "dispatch_no") ?? ""} on hold`.trim(),
          itemSub: pick(d, "customerName", "customer_name") ?? undefined,
          owner: "Warehouse",
          nextStep: "Prepare dispatch",
          targetDate: pick(d, "expectedDate", "expected_date", "createdAt", "created_at") ?? null,
          overdue: false,
          approaching: true,
          to: "/app/dispatches",
        });
      }
    }
    rows.sort((a, b) => {
      const rank = (r: PriorityRow) => (r.overdue ? 0 : r.approaching ? 1 : 2);
      const dr = rank(a) - rank(b);
      if (dr !== 0) return dr;
      return parseYMD(a.targetDate) - parseYMD(b.targetDate);
    });
    return rows.slice(0, 8);
  }, [tasksQ.data, receivables.overdue, dispatchesQ.data, debtorName]);

  // ── Inventory & forecast alerts (real reorder levels + live stock) ──
  const inventory = useMemo(() => {
    const products = ((productsQ.data ?? []) as any[]).filter(
      (p: any) => (p.status ?? "active") === "active",
    );
    const stockByProduct = new Map<string, number>();
    for (const m of (movementsQ.data ?? []) as any[]) {
      if ((m.status ?? "confirmed") !== "confirmed") continue;
      const pid = String(m.productId ?? m.product_id ?? m.product_id_fk ?? "");
      if (!pid) continue;
      const sign = m.direction === "in" ? 1 : -1;
      stockByProduct.set(pid, (stockByProduct.get(pid) ?? 0) + sign * num(m.quantity));
    }
    // Fallback: some payloads carry a live quantity on the product itself.
    const stockOf = (p: any): number => {
      if (stockByProduct.has(String(p.id))) return stockByProduct.get(String(p.id))!;
      const direct = pick(
        p,
        "stockOnHand",
        "stock_on_hand",
        "quantityOnHand",
        "quantity_on_hand",
        "stock",
        "availableQty",
        "available_qty",
      );
      return direct !== undefined ? num(direct) : 0;
    };
    // Forecast snapshots keyed by product (backend snake_case → tolerate both).
    const reorderHint = new Map<string, number>();
    try {
      const fv: any = forecastVarsQ.data;
      const snaps: any[] = fv?.snapshots ?? [];
      for (const s of snaps) {
        const pid = String(s.product_id ?? s.productId ?? s.id ?? "");
        const qty = num(
          s.recommended_reorder ?? s.recommendedReorder ?? s.final_forecast ?? s.finalForecast,
        );
        if (pid && qty > 0) reorderHint.set(pid, qty);
      }
    } catch {
      /* forecast unavailable — reorder levels still apply */
    }
    const alerts: InventoryAlert[] = [];
    let healthy = 0;
    for (const p of products) {
      const stock = stockOf(p);
      const rlRaw = pick(p, "reorderLevel", "reorder_level");
      const rl = rlRaw === undefined || rlRaw === null ? null : num(rlRaw);
      const hint = reorderHint.get(String(p.id)) ?? 0;
      if (stock <= 0) {
        alerts.push({
          id: String(p.id),
          sku: String(p.sku ?? "—"),
          name: String(p.name ?? ""),
          stock,
          reorderLevel: rl,
          forecastNote:
            hint > 0 ? `Forecast suggests reorder of ${hint} units` : "No stock on hand",
          status: "Out of Stock",
          severity: "critical",
        });
      } else if (rl !== null && stock <= rl) {
        alerts.push({
          id: String(p.id),
          sku: String(p.sku ?? "—"),
          name: String(p.name ?? ""),
          stock,
          reorderLevel: rl,
          forecastNote:
            hint > 0 ? `Forecast suggests reorder of ${hint} units` : "At or below reorder level",
          status: "Low Stock",
          severity: "attention",
        });
      } else if (hint > 0) {
        alerts.push({
          id: String(p.id),
          sku: String(p.sku ?? "—"),
          name: String(p.name ?? ""),
          stock,
          reorderLevel: rl,
          forecastNote: `Forecast suggests reorder of ${hint} units`,
          status: "Reorder Soon",
          severity: "warn",
        });
      } else {
        healthy += 1;
      }
    }
    alerts.sort((a, b) => {
      const rank = { critical: 0, attention: 1, warn: 2 } as const;
      return rank[a.severity] - rank[b.severity] || a.stock - b.stock;
    });
    const out = alerts.filter((a) => a.status === "Out of Stock").length;
    const low = alerts.filter((a) => a.status !== "Out of Stock").length;
    return { alerts: alerts.slice(0, 6), all: alerts, healthy, out, low, total: products.length };
  }, [productsQ.data, movementsQ.data, forecastVarsQ.data]);

  // ── Operational alerts (merged, ordered by importance) ──
  const operationalAlerts = useMemo<OpAlert[]>(() => {
    const rows: OpAlert[] = [];
    for (const a of (alertsQ.data ?? []) as any[]) {
      const sev = String(a.severity ?? "").toLowerCase();
      rows.push({
        id: String(a.id),
        area: String(a.type ?? "General").replace(/_/g, " "),
        issue: String(a.message ?? "Alert"),
        owner: "Operations",
        priority: sev.includes("crit")
          ? "Critical"
          : sev.includes("high")
            ? "High"
            : sev.includes("med")
              ? "Medium"
              : "Info",
        targetDate: a.created_at ?? a.createdAt ?? null,
        overdue: sev.includes("crit"),
        to: "/app/alerts",
      });
    }
    for (const p of (cashForecastQ.data?.alerts ?? []) as any[]) {
      rows.push({
        id: `cash-${p.id ?? p.message}`,
        area: "Cash",
        issue: String(p.message ?? "Treasury alert"),
        detail: p.amount ? `₹${Number(p.amount).toLocaleString("en-IN")}` : undefined,
        owner: "Treasury",
        priority: String(p.severity).toLowerCase() === "critical" ? "Critical" : "High",
        targetDate: null,
        overdue: String(p.severity).toLowerCase() === "critical",
        to: "/app/cash-flow",
      });
    }
    if (receivables.overdueCount > 0) {
      rows.push({
        id: "op-overdue-recv",
        area: "Finance",
        issue: `${receivables.overdueCount} overdue receivable${receivables.overdueCount > 1 ? "s" : ""}`,
        owner: "Treasury",
        priority: "Critical",
        targetDate: null,
        overdue: true,
        to: "/app/invoices",
      });
    }
    if (payables.overdueCount > 0) {
      rows.push({
        id: "op-overdue-pay",
        area: "Finance",
        issue: `${payables.overdueCount} overdue payable${payables.overdueCount > 1 ? "s" : ""}`,
        owner: "Treasury",
        priority: "High",
        targetDate: null,
        overdue: true,
        to: "/app/purchases",
      });
    }
    if (inventory.out > 0) {
      rows.push({
        id: "op-oos",
        area: "Inventory",
        issue: `${inventory.out} SKU${inventory.out > 1 ? "s" : ""} out of stock`,
        owner: "Warehouse",
        priority: "Critical",
        targetDate: null,
        overdue: true,
        to: "/app/forecast",
      });
    }
    if ((tasksQ.data ?? []).length > 0) {
      const urgent = ((tasksQ.data ?? []) as any[]).filter((t: any) =>
        ["urgent", "high"].includes(String(t.priority)),
      ).length;
      if (urgent > 0) {
        rows.push({
          id: "op-checker",
          area: "Checker",
          issue: `${urgent} high-priority approval${urgent > 1 ? "s" : ""} pending`,
          owner: "Checker",
          priority: "High",
          targetDate: null,
          overdue: false,
          to: "/app/checker",
        });
      }
    }
    const rank = { Critical: 0, High: 1, Medium: 2, Info: 3 } as const;
    return rows.sort((a, b) => rank[a.priority] - rank[b.priority]).slice(0, 10);
  }, [
    alertsQ.data,
    cashForecastQ.data,
    receivables.overdueCount,
    payables.overdueCount,
    inventory.out,
    tasksQ.data,
  ]);

  // ── Sales slice (existing sales order + invoice states) ──
  const sales = useMemo(() => {
    const sos = (salesOrdersQ.data ?? []) as any[];
    const inv = (invoicesQ.data ?? []) as any[];
    const disp = (dispatchesQ.data ?? []) as any[];
    const val = (o: any) =>
      num(pick(o, "grandTotal", "grand_total", "totalAmount", "total_amount", "amount"));
    const st = (o: any) => String(o.status ?? "").toLowerCase();
    const awaiting = sos.filter((o) =>
      ["sent", "awaiting_acceptance", "pending_acceptance", "awaiting_customer", "draft"].includes(
        st(o),
      ),
    );
    const accepted = sos.filter((o) =>
      ["accepted", "confirmed", "approved", "partially_dispatched", "warehouse_pending"].includes(
        st(o),
      ),
    );
    const dispatchReady = sos.filter(
      (o) =>
        (o.warehouse_status ?? o.warehouseStatus) === "approved" &&
        ["confirmed", "partially_dispatched"].includes(st(o)),
    );
    return {
      totalValue: sos.reduce((s, o) => s + val(o), 0),
      count: sos.length,
      awaitingCount: awaiting.length,
      awaitingValue: awaiting.reduce((s, o) => s + val(o), 0),
      acceptedCount: accepted.length,
      acceptedValue: accepted.reduce((s, o) => s + val(o), 0),
      invoiceCount: inv.length,
      invoiceTotal: inv.reduce((s, i) => s + num(i.amount), 0),
      dispatchReadyCount: Math.max(
        dispatchReady.length,
        disp.filter((d: any) => ["draft", "pending", "packed", "awaiting_pick"].includes(st(d)))
          .length,
      ),
      awaiting,
      accepted,
    };
  }, [salesOrdersQ.data, invoicesQ.data, dispatchesQ.data]);

  const procurement = useMemo(() => {
    const pos = (purchaseOrdersQ.data ?? []) as any[];
    const grns = (receiptsQ.data ?? []) as any[];
    const st = (o: any) => String(o.status ?? "").toLowerCase();
    const pendingConfirm = pos.filter((o) =>
      ["sent", "awaiting_confirmation", "pending_supplier", "awaiting_supplier"].includes(st(o)),
    );
    const delayed = grns.filter((g: any) => ["delayed", "pending", "overdue"].includes(st(g)));
    return {
      count: pos.length,
      pendingConfirm: pendingConfirm.length,
      delayedGrn: delayed.length,
      pendingConfirmRows: pendingConfirm.slice(0, 4),
    };
  }, [purchaseOrdersQ.data, receiptsQ.data]);

  return {
    loading,
    errors: {
      cash: cashSummaryQ.isError && cashAccountsQ.isError,
      tasks: tasksQ.isError,
      inventory: productsQ.isError && movementsQ.isError,
    },
    availableCash,
    cashSummary: cashSummaryQ.data,
    cashForecast: cashForecastQ.data,
    cashForecastLoading: cashForecastQ.isLoading,
    receivables,
    payables,
    debtorName,
    supplierName,
    priorities,
    prioritiesLoading: tasksQ.isLoading,
    inventory,
    inventoryLoading: productsQ.isLoading || movementsQ.isLoading,
    operationalAlerts,
    alertsLoading: alertsQ.isLoading,
    sales,
    procurement,
    openTaskCount: (tasksQ.data ?? []).length,
    attentionCount:
      priorities.length + receivables.overdueCount + payables.overdueCount + inventory.out,
    refetch: {
      cash: () => {
        cashSummaryQ.refetch();
        cashForecastQ.refetch();
        cashAccountsQ.refetch();
      },
    },
  };
}

export type CommandData = ReturnType<typeof useCommandData>;
