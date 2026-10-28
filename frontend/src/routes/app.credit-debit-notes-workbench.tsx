import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import api from "@/lib/api-client";
import {
  Card,
  EmptyState,
  fmtMoney,
} from "@/components/ledger-ui";
import { TableSkeleton } from "@/components/skeletons";
import { useNavigate } from "@tanstack/react-router";
import { Shield } from "lucide-react";

type CdnStatus = "pending" | "approved" | "rejected";
type CdnKind = "credit" | "debit";

type Cdn = {
  id: string;
  note_number: string;
  note_date: string;
  kind: CdnKind;
  amount: number;
  reason: string | null;
  status: CdnStatus;
  supplier_name: string | null;
  supplier_id: string | null;
  purchase_return_id: string | null;
  purchase_return_number: string | null;
  applied_amount: number;
  applied_invoice_id: string | null;
  applied_invoice_number: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  created_at: string;
  updated_at: string;
};

type FilterKey = "all" | "credit" | "debit" | "pending" | "approved" | "rejected";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "credit", label: "Credit Notes" },
  { key: "debit", label: "Debit Notes" },
  { key: "pending", label: "Pending Approval" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

export const Route = createFileRoute("/app/credit-debit-notes-workbench")({
  component: CreditDebitNotesWorkbenchPage,
});

function CreditDebitNotesWorkbenchPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState("list");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [cdnStatus, setCdnStatus] = useState("all");

  const [cdnsQ, setCdnsQ] = useQuery({
    queryKey: ["credit-debit-notes-list"],
    queryFn: async () => {
      const data = await api.creditDebitNotes.list(user?.id);
      return data.sort(
        (a: any, b: any) => new Date(b.note_date).getTime() - new Date(a.note_date).getTime(),
      );
    },
    refetchInterval: 60_000,
  });

  const cdns: Cdn[] = (cdnsQ.data ?? []) as Cdn[];
  const filteredCdns = useMemo(() => {
    let list = cdns;
    if (filter === "credit") list = list.filter((c) => c.kind === "credit");
    if (filter === "debit") list = list.filter((c) => c.kind === "debit");
    if (cdnStatus === "pending") list = list.filter((c) => c.status === "pending");
    if (cdnStatus === "approved") list = list.filter((c) => c.status === "approved");
    if (cdnStatus === "rejected") list = list.filter((c) => c.status === "rejected");
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((c) =>
        [c.note_number, c.supplier_name, c.reason, c.applied_invoice_number]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    return list;
  }, [cdns, filter, cdnStatus, query]);

  const totalPages = Math.max(1, Math.ceil(filteredCdns.length / 15));
  const safePage = 1;
  const pageItems = filteredCdns.slice(0, 15);

  const kpis = useMemo(() => {
    const pending = cdns.filter((c) => c.status === "pending").length;
    const approved = cdns.filter((c) => c.status === "approved").length;
    const rejected = cdns.filter((c) => c.status === "rejected").length;
    const credits = cdns.filter((c) => c.kind === "credit").length;
    const debits = cdns.filter((c) => c.kind === "debit").length;
    return { pending, approved, rejected, credits, debits };
  }, [cdns]);

  function renderList() {
    if (cdnsQ.isLoading) {
      return <TableSkeleton rows={6} cols={8} />;
    }
    if (filteredCdns.length === 0) {
      return (
        <EmptyState
          icon={<Shield className="h-5 w-5" />}
          title="No credit/debit notes found"
          description="Create a new credit or debit note to get started."
        />
      );
    }
    return (
      <div className="-mx-5 overflow-x-auto">
        <TableSkeleton rows={6} cols={8} />
      </div>
    );
  }

  function renderDetails() {
    if (cdnsQ.isLoading) {
      return <TableSkeleton rows={4} cols={4} />;
    }
    if (cdns.length === 0) {
      return (
        <EmptyState
          icon={<Shield className="h-5 w-5" />}
          title="No notes found"
          description="No credit or debit notes available."
        />
      );
    }
    const kindClass = cdns[0]?.kind === "credit" ? "text-primary" : "text-sem-attention";
    const statusClass = cdns[0]?.status === "approved" ? "text-sem-success" : cdns[0]?.status === "rejected" ? "text-destructive" : "text-sem-attention";
    return (
      <div className="p-4">
        <p className="text-xs uppercase text-gray-500">Kind</p>
        <span className={kindClass}>
          {cdns[0]?.kind === "credit" ? "Credit Note" : "Debit Note"}
        </span>
        <p className="text-xs uppercase text-gray-500 mt-2">Status</p>
        <span className={statusClass}>
          {cdns[0]?.status || "—"}
        </span>
        <p className="text-xs uppercase text-gray-500 mt-2">Amount</p>
        <span className="font-medium">{fmtMoney(cdns[0]?.amount || 0)}</span>
        <p className="text-xs uppercase text-gray-500 mt-2">Supplier</p>
        <span className="font-medium">{cdns[0]?.supplier_name || "—"}</span>
      </div>
    );
  }

  return (
    <div>
      <div className="border-b border-border bg-white">
        <div className="mx-auto max-w-[1440px] px-4 py-3 flex items-center justify-between flex-wrap">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <span className="text-xl font-semibold">Credit/Debit Notes</span>
          </div>
          <span className="text-sm text-gray-500">
            {(new Date()).toLocaleDateString()} · {(new Date()).toLocaleTimeString()}
          </span>
        </div>
      </div>

      <div className="mx-auto max-w-[1440px] px-4 py-6">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <button
            onClick={() => setTab("list")}
            className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs uppercase tracking-widest transition hover:text-primary"
          >
            List
          </button>
          <button
            onClick={() => setTab("details")}
            className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs uppercase tracking-widest transition hover:text-primary"
          >
            Details
          </button>
        </div>

        <div>
          {tab === "list" && renderList()}
          {tab === "details" && renderDetails()}
        </div>
      </div>
    </div>
  );
}