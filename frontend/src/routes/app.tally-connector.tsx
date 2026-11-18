import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileCode2,
  FileSpreadsheet,
  FileText,
  History,
  Info,
  LinkIcon,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api-client";
import { PageHeader, Card, EmptyState, fmtMoney } from "@/components/ledger-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/app/tally-connector")({
  component: TallyIntegrationPage,
});

type ExportType =
  | "customers"
  | "suppliers"
  | "stock-items"
  | "units"
  | "ledgers"
  | "sales"
  | "purchases"
  | "receipts"
  | "payments"
  | "credit-notes"
  | "debit-notes";

const MASTERS: { type: ExportType; label: string; desc: string }[] = [
  { type: "customers", label: "Customers", desc: "Debtor ledgers with GSTIN, billing address & state" },
  { type: "suppliers", label: "Suppliers", desc: "Creditor ledgers with GSTIN & address" },
  { type: "stock-items", label: "Stock Items", desc: "SKUs with GST rates, HSN, units & opening balance" },
  { type: "units", label: "Units of Measure", desc: "Standard measurement units (pics, nos, kg, etc.)" },
  { type: "ledgers", label: "Account Ledgers", desc: "Sales, purchase, bank & GST tax duty ledgers" },
];

const TRANSACTIONS: { type: ExportType; label: string; desc: string }[] = [
  { type: "sales", label: "Sales Invoices", desc: "Tax invoices with item-level GST & bill references" },
  { type: "purchases", label: "Purchase Invoices", desc: "Vendor invoices with input tax credits" },
  { type: "receipts", label: "Receipts", desc: "Customer payments with invoice bill allocations" },
  { type: "payments", label: "Payments", desc: "Vendor payments against purchase bills" },
  { type: "credit-notes", label: "Credit Notes", desc: "Customer returns adjusted against original sales" },
  { type: "debit-notes", label: "Debit Notes", desc: "Supplier returns adjusted against purchase bills" },
];

const INDIAN_STATES = [
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
];

const MAPPING_FIELDS: { key: string; label: string; section: string }[] = [
  { key: "salesLedger", label: "Sales ledger", section: "Voucher ledgers" },
  { key: "purchaseLedger", label: "Purchase ledger", section: "Voucher ledgers" },
  { key: "bankLedger", label: "Bank ledger", section: "Voucher ledgers" },
  { key: "cashLedger", label: "Cash ledger", section: "Voucher ledgers" },
  { key: "freightLedger", label: "Freight ledger", section: "Voucher ledgers" },
  { key: "roundOffLedger", label: "Round-off ledger", section: "Voucher ledgers" },
  { key: "advanceReceivedLedger", label: "Advance received ledger", section: "Voucher ledgers" },
  { key: "advancePaidLedger", label: "Advance paid ledger", section: "Voucher ledgers" },
  { key: "cgstOutputLedger", label: "CGST output", section: "GST ledgers" },
  { key: "sgstOutputLedger", label: "SGST output", section: "GST ledgers" },
  { key: "utgstOutputLedger", label: "UTGST output", section: "GST ledgers" },
  { key: "igstOutputLedger", label: "IGST output", section: "GST ledgers" },
  { key: "cgstInputLedger", label: "CGST input", section: "GST ledgers" },
  { key: "sgstInputLedger", label: "SGST input", section: "GST ledgers" },
  { key: "utgstInputLedger", label: "UTGST input", section: "GST ledgers" },
  { key: "igstInputLedger", label: "IGST input", section: "GST ledgers" },
  { key: "debtorsGroup", label: "Debtors group", section: "Groups" },
  { key: "creditorsGroup", label: "Creditors group", section: "Groups" },
  { key: "salesGroup", label: "Sales group", section: "Groups" },
  { key: "purchaseGroup", label: "Purchase group", section: "Groups" },
  { key: "bankGroup", label: "Bank group", section: "Groups" },
  { key: "gstGroup", label: "GST group", section: "Groups" },
];

function statusTone(status: string): string {
  if (["Imported", "Generated", "Ready"].includes(status)) return "success";
  if (["Downloaded", "Exported"].includes(status)) return "info";
  if (["Validation Failed", "Failed"].includes(status)) return "critical";
  if (["Needs Review"].includes(status)) return "attention";
  return "neutral";
}

function money(n: unknown) {
  return fmtMoney(Number(n) || 0);
}

function TallyIntegrationPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("overview");
  const [activeMasterSubTab, setActiveMasterSubTab] = useState<ExportType>("customers");
  const [activeTxSubTab, setActiveTxSubTab] = useState<ExportType>("sales");

  const overview = useQuery({
    queryKey: ["tally-overview"],
    queryFn: () => api.tally.overview(),
  });
  const configQuery = useQuery({
    queryKey: ["tally-config"],
    queryFn: () => api.tally.getConfig(),
  });

  const configured = !!configQuery.data?.configured;
  const targetCompany = configQuery.data?.config?.companyName || "Not Configured";

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Integrations & ERP"
        title="TallyPrime XML Export & Import Workbench"
        description="Production-ready manual file-based integration. Export validated master and voucher XML in TallyPrime format, download batch manifests, and confirm import results."
        icon={<LinkIcon className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-200">
              Target Company: <strong className="ml-1">{targetCompany}</strong>
            </Badge>
            <Button variant="outline" onClick={() => setTab("config")}>
              <Settings2 className="mr-2 h-4 w-4" /> Configuration
            </Button>
          </div>
        }
      />

      <div className="mx-auto w-full max-w-[1440px] px-6 py-6 md:px-10">
        {!configured && !configQuery.isLoading && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Configure your Tally company name, home state, godown, and ledger mappings before exporting.
            </div>
            <Button size="sm" onClick={() => setTab("config")}>
              Open configuration
            </Button>
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-5 flex h-auto flex-wrap justify-start gap-1">
            <TabsTrigger value="overview">Overview Dashboard</TabsTrigger>
            <TabsTrigger value="masters">Master Export</TabsTrigger>
            <TabsTrigger value="transactions">Transaction Export</TabsTrigger>
            <TabsTrigger value="history">Export History</TabsTrigger>
            <TabsTrigger value="reverse-import">Reverse Import</TabsTrigger>
            <TabsTrigger value="config">Configuration & Mapping</TabsTrigger>
            <TabsTrigger value="instructions">Import Instructions</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewTab
              overview={overview.data}
              loading={overview.isLoading}
              onGoMaster={(sub) => {
                setActiveMasterSubTab(sub);
                setTab("masters");
              }}
              onGoTx={(sub) => {
                setActiveTxSubTab(sub);
                setTab("transactions");
              }}
              onGo={(t) => setTab(t)}
            />
          </TabsContent>

          <TabsContent value="masters">
            <MasterExportPanel
              configured={configured}
              targetCompany={targetCompany}
              activeSubTab={activeMasterSubTab}
              onSubTabChange={setActiveMasterSubTab}
              onGoConfig={() => setTab("config")}
              onDone={() => {
                qc.invalidateQueries({ queryKey: ["tally-overview"] });
                qc.invalidateQueries({ queryKey: ["tally-batches"] });
              }}
            />
          </TabsContent>

          <TabsContent value="transactions">
            <TransactionExportPanel
              configured={configured}
              targetCompany={targetCompany}
              activeSubTab={activeTxSubTab}
              onSubTabChange={setActiveTxSubTab}
              onGoConfig={() => setTab("config")}
              onDone={() => {
                qc.invalidateQueries({ queryKey: ["tally-overview"] });
                qc.invalidateQueries({ queryKey: ["tally-batches"] });
              }}
            />
          </TabsContent>

          <TabsContent value="history">
            <HistoryTab />
          </TabsContent>

          <TabsContent value="reverse-import">
            <ReverseImportTab />
          </TabsContent>

          <TabsContent value="config">
            <ConfigTab
              data={configQuery.data}
              loading={configQuery.isLoading}
              onSaved={() => {
                configQuery.refetch();
                qc.invalidateQueries({ queryKey: ["tally-overview"] });
              }}
            />
          </TabsContent>

          <TabsContent value="instructions">
            <InstructionsTab onGoConfirm={() => setTab("history")} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "success" | "critical" | "warning";
}) {
  const toneClasses =
    tone === "success"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "critical"
      ? "text-rose-700 dark:text-rose-400"
      : tone === "warning"
      ? "text-amber-700 dark:text-amber-400"
      : "text-foreground";

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${toneClasses}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function OverviewTab({
  overview,
  loading,
  onGoMaster,
  onGoTx,
  onGo,
}: {
  overview: any;
  loading: boolean;
  onGoMaster: (type: ExportType) => void;
  onGoTx: (type: ExportType) => void;
  onGo: (tab: string) => void;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl border border-border bg-muted/40" />
        ))}
      </div>
    );
  }
  if (!overview) return <EmptyState title="No Tally data" description="Load the page again." />;

  const k = overview.kpis || {};
  const stats = overview.entityStats || {};

  return (
    <div className="space-y-6">
      {/* 9 Standard Required KPIs */}
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Integration Metrics
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <Kpi label="Total Eligible Records" value={String(k.totalEligible ?? 0)} hint="All supported DB records" />
          <Kpi label="Total Records Exported" value={String(k.totalExported ?? 0)} hint="Generated in batches" tone="default" />
          <Kpi label="Awaiting Export" value={String(k.totalAwaiting ?? 0)} hint="Ready for export" tone="warning" />
          <Kpi label="Imported (User Confirmed)" value={String(k.totalImported ?? 0)} hint="Confirmed in TallyPrime" tone="success" />
          <Kpi label="Records Requiring Attention" value={String(k.needingReview ?? 0)} hint="Changed post-export" tone={k.needingReview > 0 ? "warning" : "default"} />
          <Kpi label="Failed Exports" value={String(k.totalFailed ?? 0)} hint="Validation failures" tone={k.totalFailed > 0 ? "critical" : "default"} />
          <Kpi label="Exported Transaction Value" value={money(k.totalExportedValue)} hint="Cumulative voucher value" tone="success" />
          <Kpi label="Completed Batches" value={String(k.completedBatches ?? 0)} hint="Generated & audited" />
          <Kpi
            label="Last Export Date"
            value={k.lastExportDate ? new Date(k.lastExportDate).toLocaleDateString() : "Never"}
            hint={k.lastExportDate ? new Date(k.lastExportDate).toLocaleTimeString() : undefined}
          />
        </div>
      </div>

      {/* Entity Breakdown Cards */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Masters Breakdown">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Master Type</TableHead>
                <TableHead className="text-right">Eligible</TableHead>
                <TableHead className="text-right">Exported</TableHead>
                <TableHead className="text-right">Awaiting</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {MASTERS.map((m) => {
                const s = stats[m.type] || { eligible: 0, exported: 0, awaiting: 0 };
                return (
                  <TableRow key={m.type}>
                    <TableCell>
                      <div className="font-medium">{m.label}</div>
                      <div className="text-[11px] text-muted-foreground">{m.desc}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.eligible}</TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-600 font-medium">
                      {s.exported}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-amber-600">{s.awaiting}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => onGoMaster(m.type)}>
                        Export <ArrowRight className="ml-1 h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>

        <Card title="Transactions Breakdown">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Voucher Type</TableHead>
                <TableHead className="text-right">Eligible</TableHead>
                <TableHead className="text-right">Exported</TableHead>
                <TableHead className="text-right">Total Value</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {TRANSACTIONS.map((t) => {
                const s = stats[t.type] || { eligible: 0, exported: 0, awaiting: 0, value: 0 };
                return (
                  <TableRow key={t.type}>
                    <TableCell>
                      <div className="font-medium">{t.label}</div>
                      <div className="text-[11px] text-muted-foreground">{t.desc}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.eligible}</TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-600 font-medium">
                      {s.exported}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(s.value)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => onGoTx(t.type)}>
                        Export <ArrowRight className="ml-1 h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* Recent Activity Table */}
      <Card
        title="Recent Export Batches"
        action={
          <Button size="sm" variant="outline" onClick={() => onGo("history")}>
            <History className="mr-2 h-4 w-4" /> View Full History
          </Button>
        }
      >
        {overview.recentBatches?.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Batch ID</TableHead>
                <TableHead>Export Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Records</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Export Date</TableHead>
                <TableHead>Created By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.recentBatches.map((b: any) => (
                <TableRow key={b.id}>
                  <TableCell className="font-mono text-xs font-semibold">{b.batchNumber}</TableCell>
                  <TableCell className="capitalize">{String(b.exportType).replace(/-/g, " ")}</TableCell>
                  <TableCell>
                    <StatusBadge severity={statusTone(b.status)} text={b.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{b.recordCount}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{money(b.totals?.grandTotal)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(b.generatedAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{b.generatedBy || "System"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            icon={<UploadCloud className="h-5 w-5" />}
            title="No Export Batches Yet"
            description="Export masters first so your vouchers can link to existing Tally ledgers and stock items."
            action={<Button onClick={() => onGo("masters")}>Export Masters</Button>}
          />
        )}
      </Card>
    </div>
  );
}

// ─── Master Export Panel ────────────────────────────────────────────────────

function MasterExportPanel({
  configured,
  targetCompany,
  activeSubTab,
  onSubTabChange,
  onGoConfig,
  onDone,
}: {
  configured: boolean;
  targetCompany: string;
  activeSubTab: ExportType;
  onSubTabChange: (t: ExportType) => void;
  onGoConfig: () => void;
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeWorkflowRecord, setActiveWorkflowRecord] = useState<any | null>(null);

  const recordsQuery = useQuery({
    queryKey: ["tally-records", activeSubTab],
    queryFn: () => api.tally.records(activeSubTab),
    enabled: configured,
  });

  const records: any[] = useMemo(() => recordsQuery.data?.records ?? [], [recordsQuery.data]);

  const filtered = useMemo(() => {
    return records.filter((r) => {
      const matchSearch =
        !search ||
        (r.label && r.label.toLowerCase().includes(search.toLowerCase())) ||
        (r.docNumber && r.docNumber.toLowerCase().includes(search.toLowerCase())) ||
        (r.party && r.party.toLowerCase().includes(search.toLowerCase()));

      const matchStatus =
        statusFilter === "all" ||
        (statusFilter === "exported" && ["Exported", "Downloaded", "Imported"].includes(r.exportedStatus)) ||
        (statusFilter === "ready" && (!r.exportedStatus || r.exportedStatus === "Ready")) ||
        (statusFilter === "review" && r.exportedStatus === "Needs Review") ||
        (statusFilter === "failed" && r.exportedStatus === "Validation Failed");

      return matchSearch && matchStatus;
    });
  }, [records, search, statusFilter]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function toggleAllFiltered() {
    const filteredIds = filtered.map((r) => r.sourceId);
    const allSelected = filteredIds.every((id) => selected.has(id));
    const next = new Set(selected);
    if (allSelected) {
      filteredIds.forEach((id) => next.delete(id));
    } else {
      filteredIds.forEach((id) => next.add(id));
    }
    setSelected(next);
  }

  if (!configured) {
    return (
      <Card title="Master Export">
        <EmptyState
          icon={<Settings2 className="h-5 w-5" />}
          title="Configure Tally First"
          description="Please specify the exact target Tally company name, home state, warehouse, and ledger mapping before generating master files."
          action={<Button onClick={onGoConfig}>Open Configuration</Button>}
        />
      </Card>
    );
  }

  const selectedCount = selected.size;

  return (
    <div className="space-y-5">
      <Card
        title="Master Export"
        action={
          <Badge variant="outline" className="text-xs">
            Target Company: <strong className="ml-1">{targetCompany}</strong>
          </Badge>
        }
      >
        <p className="mb-4 text-sm text-muted-foreground">
          Export Customers, Suppliers, Stock Items, Units, and Ledgers into TallyPrime (REPORTNAME=All Masters).
          Tally requires these masters to exist before importing transaction vouchers.
        </p>

        {/* Sub-tabs */}
        <div className="mb-5 flex flex-wrap gap-2 border-b border-border pb-3">
          {MASTERS.map((m) => (
            <button
              key={m.type}
              onClick={() => {
                onSubTabChange(m.type);
                setSelected(new Set());
                setSearch("");
              }}
              className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition-all ${
                activeSubTab === m.type
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "border border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Filter bar */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={`Search ${activeSubTab}...`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 text-xs"
              />
            </div>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-xs"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All Statuses</option>
              <option value="ready">Awaiting / Ready</option>
              <option value="exported">Exported / Imported</option>
              <option value="review">Needs Review</option>
              <option value="failed">Validation Failed</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={toggleAllFiltered} disabled={!filtered.length}>
              {filtered.length > 0 && filtered.every((r) => selected.has(r.sourceId))
                ? "Deselect Filtered"
                : `Select All Filtered (${filtered.length})`}
            </Button>
            <Button
              size="sm"
              disabled={selectedCount === 0}
              onClick={() => {
                setActiveWorkflowRecord({
                  type: activeSubTab,
                  ids: Array.from(selected),
                  title: `Batch Export: ${selectedCount} ${activeSubTab}`,
                });
              }}
            >
              <FileCode2 className="mr-1.5 h-4 w-4" /> Export Selected ({selectedCount})
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!filtered.length}
              onClick={() => {
                const eligibleIds = filtered
                  .filter((r) => !r.exportedStatus || r.exportedStatus === "Ready")
                  .map((r) => r.sourceId);
                const ids = eligibleIds.length ? eligibleIds : filtered.map((r) => r.sourceId);
                setActiveWorkflowRecord({
                  type: activeSubTab,
                  ids,
                  title: `Export All (${ids.length} records)`,
                });
              }}
            >
              Export All Eligible
            </Button>
          </div>
        </div>

        {/* Data Table */}
        {recordsQuery.isLoading ? (
          <div className="h-48 animate-pulse rounded-xl border border-border bg-muted/40" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<FileCode2 className="h-5 w-5" />}
            title="No records found"
            description="No records match your search or filter criteria."
          />
        ) : (
          <div className="max-h-[500px] overflow-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && filtered.every((r) => selected.has(r.sourceId))}
                      onChange={toggleAllFiltered}
                    />
                  </TableHead>
                  <TableHead>Name / Description</TableHead>
                  <TableHead>Code / Group</TableHead>
                  <TableHead>Details / Issues</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Tally Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const isChecked = selected.has(r.sourceId);
                  return (
                    <TableRow key={r.sourceId} className={isChecked ? "bg-primary/5" : ""}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggle(r.sourceId)}
                          aria-label={`Select ${r.label}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-foreground">{r.label}</div>
                        <div className="text-[11px] text-muted-foreground">{r.party || r.voucherType}</div>
                      </TableCell>
                      <TableCell className="text-xs font-mono">{r.docNumber || "—"}</TableCell>
                      <TableCell>
                        <div className="text-xs text-muted-foreground">{r.detail || "—"}</div>
                        {r.missingInfo?.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {r.missingInfo.map((m: string, i: number) => (
                              <Badge key={i} variant="outline" className="border-rose-300 text-[10px] text-rose-700">
                                {m}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {r.amount > 0 ? money(r.amount) : "—"}
                      </TableCell>
                      <TableCell>
                        {r.exportedStatus ? (
                          <StatusBadge severity={statusTone(r.exportedStatus)} text={r.exportedStatus} />
                        ) : (
                          <Badge variant="outline" className="text-[11px] text-muted-foreground">
                            Awaiting Export
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setActiveWorkflowRecord({
                              type: activeSubTab,
                              ids: [r.sourceId],
                              title: `Single Export: ${r.label}`,
                            });
                          }}
                        >
                          <FileCode2 className="mr-1 h-3.5 w-3.5" /> Export XML
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* Guided Export Workflow Dialog */}
      {activeWorkflowRecord && (
        <ExportWorkflowDialog
          exportType={activeWorkflowRecord.type}
          ids={activeWorkflowRecord.ids}
          title={activeWorkflowRecord.title}
          targetCompany={targetCompany}
          onClose={() => setActiveWorkflowRecord(null)}
          onSuccess={() => {
            recordsQuery.refetch();
            onDone();
          }}
        />
      )}
    </div>
  );
}

// ─── Transaction Export Panel ───────────────────────────────────────────────

function TransactionExportPanel({
  configured,
  targetCompany,
  activeSubTab,
  onSubTabChange,
  onGoConfig,
  onDone,
}: {
  configured: boolean;
  targetCompany: string;
  activeSubTab: ExportType;
  onSubTabChange: (t: ExportType) => void;
  onGoConfig: () => void;
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 15;
  const [activeWorkflowRecord, setActiveWorkflowRecord] = useState<any | null>(null);

  const recordsQuery = useQuery({
    queryKey: ["tally-records", activeSubTab],
    queryFn: () => api.tally.records(activeSubTab),
    enabled: configured,
  });

  const records: any[] = useMemo(() => recordsQuery.data?.records ?? [], [recordsQuery.data]);

  const filtered = useMemo(() => {
    return records.filter((r) => {
      const matchDoc =
        !search ||
        (r.docNumber && r.docNumber.toLowerCase().includes(search.toLowerCase())) ||
        (r.label && r.label.toLowerCase().includes(search.toLowerCase())) ||
        (r.party && r.party.toLowerCase().includes(search.toLowerCase()));

      const matchStatus =
        statusFilter === "all" ||
        (statusFilter === "exported" && ["Exported", "Downloaded", "Imported"].includes(r.exportedStatus)) ||
        (statusFilter === "ready" && (!r.exportedStatus || r.exportedStatus === "Ready")) ||
        (statusFilter === "review" && r.exportedStatus === "Needs Review") ||
        (statusFilter === "failed" && r.exportedStatus === "Validation Failed");

      const matchFrom = !fromDate || (r.date && r.date >= fromDate);
      const matchTo = !toDate || (r.date && r.date <= toDate);
      const matchMin = !minAmount || (Number(r.amount) >= Number(minAmount));
      const matchMax = !maxAmount || (Number(r.amount) <= Number(maxAmount));

      return matchDoc && matchStatus && matchFrom && matchTo && matchMin && matchMax;
    });
  }, [records, search, statusFilter, fromDate, toDate, minAmount, maxAmount]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function toggleAllFiltered() {
    const filteredIds = filtered.map((r) => r.sourceId);
    const allSelected = filteredIds.every((id) => selected.has(id));
    const next = new Set(selected);
    if (allSelected) {
      filteredIds.forEach((id) => next.delete(id));
    } else {
      filteredIds.forEach((id) => next.add(id));
    }
    setSelected(next);
  }

  if (!configured) {
    return (
      <Card title="Transaction Export">
        <EmptyState
          icon={<Settings2 className="h-5 w-5" />}
          title="Configure Tally First"
          description="Please specify the target Tally company name, home state, godown, and ledger mapping before generating voucher files."
          action={<Button onClick={onGoConfig}>Open Configuration</Button>}
        />
      </Card>
    );
  }

  const selectedCount = selected.size;
  const selectedTotalValue = filtered
    .filter((r) => selected.has(r.sourceId))
    .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  return (
    <div className="space-y-5">
      <Card
        title="Transaction Export"
        action={
          <Badge variant="outline" className="text-xs">
            Target Company: <strong className="ml-1">{targetCompany}</strong>
          </Badge>
        }
      >
        <p className="mb-4 text-sm text-muted-foreground">
          Export Sales Invoices, Purchases, Receipts, Payments, and Credit/Debit Notes into TallyPrime (REPORTNAME=Vouchers).
          Each transaction retains its original document number, date, party, item inventory, and GST breakup.
        </p>

        {/* Sub-tabs */}
        <div className="mb-5 flex flex-wrap gap-2 border-b border-border pb-3">
          {TRANSACTIONS.map((t) => (
            <button
              key={t.type}
              onClick={() => {
                onSubTabChange(t.type);
                setSelected(new Set());
                setSearch("");
                setPage(1);
              }}
              className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition-all ${
                activeSubTab === t.type
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "border border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Search & Multi-Filters */}
        <div className="mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search document # or party..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-8 text-xs"
            />
          </div>

          <div>
            <Input
              type="date"
              placeholder="From Date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setPage(1);
              }}
              className="text-xs"
            />
          </div>

          <div>
            <Input
              type="date"
              placeholder="To Date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setPage(1);
              }}
              className="text-xs"
            />
          </div>

          <div>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">All Export Statuses</option>
              <option value="ready">Awaiting Export</option>
              <option value="exported">Exported / Downloaded</option>
              <option value="review">Needs Review</option>
              <option value="failed">Validation Failed</option>
            </select>
          </div>

          <div>
            <Input
              type="number"
              placeholder="Min Amount"
              value={minAmount}
              onChange={(e) => {
                setMinAmount(e.target.value);
                setPage(1);
              }}
              className="text-xs"
            />
          </div>

          <div>
            <Input
              type="number"
              placeholder="Max Amount"
              value={maxAmount}
              onChange={(e) => {
                setMaxAmount(e.target.value);
                setPage(1);
              }}
              className="text-xs"
            />
          </div>
        </div>

        {/* Multi-Select Action Bar */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/80 bg-muted/20 px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="outline" onClick={toggleAllFiltered} disabled={!filtered.length}>
              {filtered.length > 0 && filtered.every((r) => selected.has(r.sourceId))
                ? "Clear Selection"
                : `Select Filtered (${filtered.length})`}
            </Button>
            <span className="text-xs text-muted-foreground">
              <strong>{selectedCount}</strong> selected &nbsp;|&nbsp; Value: <strong>{money(selectedTotalValue)}</strong>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={selectedCount === 0}
              onClick={() => {
                setActiveWorkflowRecord({
                  type: activeSubTab,
                  ids: Array.from(selected),
                  title: `Batch Export: ${selectedCount} ${activeSubTab}`,
                });
              }}
            >
              <FileCode2 className="mr-1.5 h-4 w-4" /> Export Selected ({selectedCount})
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!filtered.length}
              onClick={() => {
                const eligibleIds = filtered
                  .filter((r) => !r.exportedStatus || r.exportedStatus === "Ready")
                  .map((r) => r.sourceId);
                const ids = eligibleIds.length ? eligibleIds : filtered.map((r) => r.sourceId);
                setActiveWorkflowRecord({
                  type: activeSubTab,
                  ids,
                  title: `Export All Filtered (${ids.length} records)`,
                });
              }}
            >
              Export All Filtered
            </Button>
          </div>
        </div>

        {/* Transactions Table */}
        {recordsQuery.isLoading ? (
          <div className="h-48 animate-pulse rounded-xl border border-border bg-muted/40" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<FileCode2 className="h-5 w-5" />}
            title="No transactions found"
            description="No documents match the specified filters."
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="max-h-[500px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        checked={filtered.length > 0 && filtered.every((r) => selected.has(r.sourceId))}
                        onChange={toggleAllFiltered}
                      />
                    </TableHead>
                    <TableHead>Document #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer / Supplier</TableHead>
                    <TableHead className="text-right">Tax Amount</TableHead>
                    <TableHead className="text-right">Total Amount</TableHead>
                    <TableHead>Payment Status</TableHead>
                    <TableHead>Tally Status</TableHead>
                    <TableHead>Last Exported</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginated.map((r) => {
                    const isChecked = selected.has(r.sourceId);
                    return (
                      <TableRow key={r.sourceId} className={isChecked ? "bg-primary/5" : ""}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggle(r.sourceId)}
                            aria-label={`Select ${r.docNumber}`}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs font-semibold text-foreground">
                          {r.docNumber || r.label}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.date || "—"}</TableCell>
                        <TableCell>
                          <div className="font-medium text-xs">{r.party || "—"}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                          {r.taxAmount !== undefined ? money(r.taxAmount) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs font-semibold">
                          {money(r.amount)}
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className="capitalize">{r.paymentStatus || r.detail || "—"}</span>
                        </TableCell>
                        <TableCell>
                          {r.exportedStatus ? (
                            <StatusBadge severity={statusTone(r.exportedStatus)} text={r.exportedStatus} />
                          ) : (
                            <Badge variant="outline" className="text-[11px] text-muted-foreground">
                              Awaiting Export
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.lastExportedDate ? new Date(r.lastExportedDate).toLocaleDateString() : "Never"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setActiveWorkflowRecord({
                                type: activeSubTab,
                                ids: [r.sourceId],
                                title: `Single Export: ${r.docNumber || r.label}`,
                              });
                            }}
                          >
                            <FileCode2 className="mr-1 h-3.5 w-3.5" /> Export XML
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
                <div>
                  Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, filtered.length)} of{" "}
                  {filtered.length} entries
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" /> Prev
                  </Button>
                  <span className="px-2">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Guided Export Workflow Dialog */}
      {activeWorkflowRecord && (
        <ExportWorkflowDialog
          exportType={activeWorkflowRecord.type}
          ids={activeWorkflowRecord.ids}
          title={activeWorkflowRecord.title}
          targetCompany={targetCompany}
          onClose={() => setActiveWorkflowRecord(null)}
          onSuccess={() => {
            recordsQuery.refetch();
            onDone();
          }}
        />
      )}
    </div>
  );
}

// ─── Guided Export Workflow Dialog (Steps 1 to 7) ───────────────────────────

function ExportWorkflowDialog({
  exportType,
  ids,
  title,
  targetCompany,
  onClose,
  onSuccess,
  onGoConfig,
}: {
  exportType: ExportType;
  ids: string[];
  title: string;
  targetCompany: string;
  onClose: () => void;
  onSuccess: () => void;
  onGoConfig?: () => void;
}) {
  const [step, setStep] = useState<"validate" | "summary" | "result">("validate");
  const [force, setForce] = useState(false);
  const [batchResult, setBatchResult] = useState<any | null>(null);
  const navigate = useNavigate();

  const validateQuery = useQuery({
    queryKey: ["tally-validate", exportType, ids],
    queryFn: () => api.tally.validate({ exportType, ids }),
  });

  const exportMutation = useMutation({
    mutationFn: () => {
      const recordsToExport = force
        ? ids
        : (validateQuery.data?.records || [])
        .filter((r: any) => r.errors?.length === 0)
        .map((r: any) => r.sourceId);
      if (!recordsToExport.length) {
        throw new Error("No exportable records are available. Resolve the listed data issues first.");
      }
      return api.tally.export({ exportType, ids: recordsToExport, force });
    },
    onSuccess: (data) => {
      setBatchResult(data);
      setStep("result");
      toast.success("Tally XML Generated", {
        description: `Batch ${data.batch?.batchNumber} with ${data.batch?.recordCount} records ready for download.`,
      });
      onSuccess();
    },
    onError: (e: any) => {
      toast.error(e.message || "XML generation failed");
    },
  });

  const valData = validateQuery.data;
  const isPending = validateQuery.isLoading || exportMutation.isPending;
  const totalRecords = valData?.totalRecords ?? valData?.totalCount ?? ids.length;
  const validRecords = valData?.validRecords ?? valData?.validCount ?? 0;
  const errorRecords = valData?.errorCount ?? 0;
  const warningRecords = valData?.warningCount ?? 0;
  const forceDuplicateEligible =
    force &&
    Array.isArray(valData?.records) &&
    valData.records.some((r: any) => r.lastBatchId) &&
    valData.records.every((r: any) =>
      r.errors?.length === 0 ||
      r.errors?.some((error: string) => error.toLowerCase().includes("already exported")),
    );

  const openSourceRecord = (record: any) => {
    const routes: Record<string, string> = {
      customers: "/app/debtors",
      suppliers: "/app/suppliers",
      "stock-items": "/app/products",
      units: "/app/tally-connector",
      ledgers: "/app/tally-connector",
      sales: "/app/invoices",
      purchases: "/app/purchases",
      receipts: "/app/invoices",
      payments: "/app/purchases",
      "credit-notes": "/app/credit-debit-notes-workbench",
      "debit-notes": "/app/credit-debit-notes-workbench",
    };
    navigate({
      to: routes[exportType] || "/app/tally-connector",
      search: { sourceId: record.sourceId },
    } as any);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
          <div>
            <h2 className="text-lg font-bold text-foreground">{title}</h2>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Target Tally Company:</span>
              <Badge variant="outline" className="border-blue-400 bg-blue-50 font-semibold text-blue-900 dark:bg-blue-950 dark:text-blue-200">
                {targetCompany}
              </Badge>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ✕
          </Button>
        </div>

        {/* Step Indicator */}
        <div className="mb-5 flex items-center justify-between text-xs font-semibold text-muted-foreground border-b border-border pb-3">
          <span className={step === "validate" ? "text-primary font-bold" : ""}>1. Pre-Export Validation</span>
          <span>→</span>
          <span className={step === "summary" ? "text-primary font-bold" : ""}>2. Batch Summary & Preview</span>
          <span>→</span>
          <span className={step === "result" ? "text-emerald-600 font-bold" : ""}>3. Generated XML & Downloads</span>
        </div>

        {/* Step 1: Validation */}
        {step === "validate" && (
          <div className="space-y-4">
            {validateQuery.isLoading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="mt-3 text-sm text-muted-foreground">
                  Validating masters, ledgers, inventory, GST allocations, and voucher balances...
                </p>
              </div>
            ) : validateQuery.isError ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  <div className="flex items-start gap-2">
                    <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                    <div>
                      <div className="font-semibold">Configuration Required</div>
                      <div className="mt-1 text-xs">{(validateQuery.error as any)?.message || "Failed to validate. Please check your Tally configuration."}</div>
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={onClose}>Cancel</Button>
                  <Button onClick={() => { onClose(); onGoConfig?.(); }} variant="secondary">
                    <Settings2 className="mr-1.5 h-4 w-4" /> Open Configuration
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl border border-border p-3">
                    <div className="text-[11px] text-muted-foreground">Total Records</div>
                    <div className="text-xl font-bold">{totalRecords}</div>
                  </div>
                  <div className="rounded-xl border border-emerald-300 bg-emerald-50/50 p-3 dark:bg-emerald-950/20">
                    <div className="text-[11px] text-emerald-800 dark:text-emerald-300">Valid Records</div>
                    <div className="text-xl font-bold text-emerald-700 dark:text-emerald-400">
                      {validRecords}
                    </div>
                  </div>
                  <div className="rounded-xl border border-rose-300 bg-rose-50/50 p-3 dark:bg-rose-950/20">
                    <div className="text-[11px] text-rose-800 dark:text-rose-300">Errors</div>
                    <div className="text-xl font-bold text-rose-700 dark:text-rose-400">
                      {errorRecords}
                    </div>
                  </div>
                  <div className="rounded-xl border border-amber-300 bg-amber-50/50 p-3 dark:bg-amber-950/20">
                    <div className="text-[11px] text-amber-800 dark:text-amber-300">Warnings</div>
                    <div className="text-xl font-bold text-amber-700 dark:text-amber-400">
                      {warningRecords}
                    </div>
                  </div>
                </div>

                {valData?.configError && (
                  <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
                    <div className="flex items-start gap-2">
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <div className="font-bold">Export blocked: Tally configuration is incomplete</div>
                        <div className="mt-1 text-xs">{valData.configError}</div>
                      </div>
                    </div>
                  </div>
                )}

                {valData?.totalCount === 0 && (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    <AlertTriangle className="mb-1 h-4 w-4" />
                    No records found for export. The selected records may not exist in the database or may have been filtered out.
                  </div>
                )}

                {valData?.errorCount > 0 ? (
                  <div className="max-h-60 space-y-2 overflow-auto rounded-xl border border-rose-200 bg-rose-50/30 p-3">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-rose-800">
                      <XCircle className="h-4 w-4" /> Issues preventing direct export:
                    </div>
                    {valData?.records
                      ?.filter((r: any) => (r.errors?.length ?? 0) > 0)
                      .map((r: any) => (
                        <div key={r.sourceId} className="rounded-lg border border-rose-200 bg-card p-2.5 text-xs">
                          <div className="font-semibold text-foreground">{r.sourceLabel || r.docNumber}</div>
                          {r.exportedStatus && r.lastBatchId && (
                            <div className="mt-1 text-amber-700 dark:text-amber-300">
                              Status: Already Exported · Previous batch: {r.lastBatchId}
                              {r.exportedAt ? ` · Previous export date: ${r.exportedAt}` : ""}
                            </div>
                          )}
                          {(r.errors ?? []).map((e: string, i: number) => (
                            <div key={i} className="text-rose-600">
                              • {e}
                            </div>
                          ))}
                          <div className="mt-2 flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openSourceRecord(r)}
                            >
                              Open record
                            </Button>
                            {r.lastBatchId && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => navigate({ to: "/app/tally-connector", search: { batchId: r.lastBatchId } } as any)}
                              >
                                Open previous batch
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                ) : valData?.totalCount > 0 ? (
                  <div className="flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    All {valData.totalCount} selected records passed pre-export validation and balance perfectly!
                  </div>
                ) : null}

                <div className="flex items-center justify-between pt-3">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                    Force re-export (bypass idempotency check)
                  </label>

                  <div className="flex gap-2">
                    <Button variant="outline" onClick={onClose}>
                      Cancel
                    </Button>
                    {valData?.errorCount > 0 && (
                      <Button
                        variant="outline"
                        onClick={() => validateQuery.refetch()}
                        disabled={validateQuery.isFetching}
                      >
                        <RefreshCw className={`mr-1.5 h-4 w-4 ${validateQuery.isFetching ? "animate-spin" : ""}`} />
                        Re-run validation
                      </Button>
                    )}
                    <Button
                      onClick={() => exportMutation.mutate()}
                      disabled={
                        isPending ||
                        totalRecords === 0 ||
                        !!valData?.configError ||
                        (validRecords === 0 && !forceDuplicateEligible)
                      }
                    >
                      {exportMutation.isPending ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : (
                        <FileCode2 className="mr-1.5 h-4 w-4" />
                      )}
                      Generate Tally XML
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Step 3: Result & Downloads */}
        {step === "result" && batchResult?.batch && (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100">
              <div className="flex items-center gap-2 text-base font-bold text-emerald-800 dark:text-emerald-300">
                <CheckCircle2 className="h-5 w-5" /> TallyPrime XML Batch Successfully Created!
              </div>
              <p className="mt-1 text-xs">
                Batch <strong>{batchResult.batch.batchNumber}</strong> contains{" "}
                <strong>{batchResult.batch.recordCount}</strong> validated record(s) formatted for direct import into
                company <strong>{batchResult.batch.companyName}</strong>.
              </p>
            </div>

            {batchResult?.partialExport && batchResult.blockedCount > 0 && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
                <div className="font-bold">
                  Partial export: {batchResult.blockedCount} record(s) moved to the correction queue.
                </div>
                <div className="mt-1">
                  Only valid records are included in this XML. Download the validation report to correct blocked records and re-run validation.
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
              <div className="rounded-lg border border-border p-2.5">
                <span className="text-muted-foreground">Batch Number</span>
                <div className="font-mono font-bold">{batchResult.batch.batchNumber}</div>
              </div>
              <div className="rounded-lg border border-border p-2.5">
                <span className="text-muted-foreground">Total Value</span>
                <div className="font-bold">{money(batchResult.batch.totals?.grandTotal)}</div>
              </div>
              <div className="rounded-lg border border-border p-2.5">
                <span className="text-muted-foreground">File Size</span>
                <div className="font-bold">{(batchResult.batch.xmlBytes / 1024).toFixed(1)} KB</div>
              </div>
              <div className="rounded-lg border border-border p-2.5">
                <span className="text-muted-foreground">SHA-256 Checksum</span>
                <div className="truncate font-mono" title={batchResult.batch.xmlSha256}>
                  {batchResult.batch.xmlSha256?.slice(0, 14)}...
                </div>
              </div>
            </div>

            {/* Direct Download Actions */}
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Button
                className="bg-blue-600 hover:bg-blue-700 text-white"
                onClick={async () => {
                  try {
                    await api.tally.downloadBatch(batchResult.batch.id, batchResult.batch.fileName);
                    toast.success("XML File Downloaded", {
                      description: "Import it into your hosted TallyPrime company.",
                    });
                  } catch (e: any) {
                    toast.error(e.message || "Download failed");
                  }
                }}
              >
                <Download className="mr-2 h-4 w-4" /> Download XML File
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await api.tally.downloadManifest(
                      batchResult.batch.id,
                      `${batchResult.batch.batchNumber}-manifest.csv`,
                    );
                    toast.success("Manifest Downloaded");
                  } catch (e: any) {
                    toast.error(e.message || "Download failed");
                  }
                }}
              >
                <FileSpreadsheet className="mr-2 h-4 w-4" /> Download Manifest (CSV)
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await api.tally.downloadErrors(
                      batchResult.batch.id,
                      `${batchResult.batch.batchNumber}-report.csv`,
                    );
                    toast.success("Validation Report Downloaded");
                  } catch (e: any) {
                    toast.error(e.message || "Download failed");
                  }
                }}
              >
                <FileText className="mr-2 h-4 w-4" /> Download Report (CSV)
              </Button>
            </div>

            {/* XML Preview Accordion */}
            {batchResult.preview && (
              <details className="rounded-xl border border-border p-3 text-xs">
                <summary className="cursor-pointer font-semibold text-muted-foreground hover:text-foreground">
                  Inspect Generated XML Preview
                </summary>
                <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-[11px] leading-relaxed">
                  {batchResult.preview}
                </pre>
              </details>
            )}

            <div className="flex justify-end pt-3">
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Export History Tab ─────────────────────────────────────────────────────

function HistoryTab() {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [counts, setCounts] = useState({
    created: "",
    altered: "",
    skipped: "",
    failed: "",
    notes: "",
  });

  const batchesQuery = useQuery({
    queryKey: ["tally-batches"],
    queryFn: () => api.tally.batches(),
  });
  const detailQuery = useQuery({
    queryKey: ["tally-batch", expanded],
    queryFn: () => api.tally.batch(expanded as string),
    enabled: !!expanded,
  });

  const confirmMutation = useMutation({
    mutationFn: () =>
      api.tally.confirmImport(confirmId as string, {
        created: Number(counts.created) || 0,
        altered: Number(counts.altered) || 0,
        skipped: Number(counts.skipped) || 0,
        failed: Number(counts.failed) || 0,
        notes: counts.notes,
      }),
    onSuccess: (data) => {
      toast.success("Import Result Confirmed", {
        description: `Batch ${data.batch?.batchNumber} marked ${data.batch?.status}.`,
      });
      setConfirmId(null);
      setCounts({ created: "", altered: "", skipped: "", failed: "", notes: "" });
      batchesQuery.refetch();
      qc.invalidateQueries({ queryKey: ["tally-overview"] });
      if (expanded) detailQuery.refetch();
    },
    onError: (e: any) => toast.error(e.message || "Could not confirm import"),
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => api.tally.retryBatch(id),
    onSuccess: (data) => {
      toast.success("Retry Batch Generated", {
        description: `New batch ${data.batch?.batchNumber} created with failed records.`,
      });
      batchesQuery.refetch();
      qc.invalidateQueries({ queryKey: ["tally-overview"] });
    },
    onError: (e: any) => toast.error(e.message || "Could not retry failed records"),
  });

  const batches = batchesQuery.data?.batches ?? [];

  return (
    <div className="space-y-5">
      <Card
        title="Export History & Audit Reconciliation"
        action={
          <Button size="sm" variant="outline" onClick={() => batchesQuery.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        }
      >
        <p className="mb-4 text-sm text-muted-foreground">
          Track every exported batch, verify SHA-256 checksums, download original XML files and manifests, and record
          user-confirmed Tally import outcomes.
        </p>

        {batchesQuery.isLoading ? (
          <div className="h-40 animate-pulse rounded-xl border border-border bg-muted/40" />
        ) : batches.length === 0 ? (
          <EmptyState
            icon={<History className="h-5 w-5" />}
            title="No Batches Generated Yet"
            description="Use the Master or Transaction Export tabs to create your first XML batch."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch Number</TableHead>
                  <TableHead>Export Type</TableHead>
                  <TableHead>Batch Status</TableHead>
                  <TableHead className="text-right">Records</TableHead>
                  <TableHead className="text-right">Total Amount</TableHead>
                  <TableHead>Checksum (SHA-256)</TableHead>
                  <TableHead>Generated At</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b: any) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <button
                        className="font-mono text-xs font-semibold text-primary hover:underline"
                        onClick={() => setExpanded(expanded === b.id ? null : b.id)}
                      >
                        {b.batchNumber}
                      </button>
                      <div className="text-[11px] text-muted-foreground">{b.fileName}</div>
                    </TableCell>
                    <TableCell className="capitalize">{String(b.exportType).replace(/-/g, " ")}</TableCell>
                    <TableCell>
                      <StatusBadge severity={statusTone(b.status)} text={b.status} />
                      {b.importResult && (
                        <div className="mt-1 text-[10px] text-muted-foreground font-mono">
                          Created:{b.importResult.created} Alt:{b.importResult.altered} Skip:{b.importResult.skipped} Fail:
                          {b.importResult.failed}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {b.recordCount}
                      {b.errorCount > 0 && <span className="ml-1 text-rose-600">({b.errorCount} failed)</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {money(b.totals?.grandTotal)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      <span title={b.xmlSha256}>{b.xmlSha256 ? `${b.xmlSha256.slice(0, 10)}...` : "—"}</span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(b.generatedAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            try {
                              await api.tally.downloadBatch(b.id, b.fileName);
                              toast.success("XML Downloaded");
                              batchesQuery.refetch();
                            } catch (e: any) {
                              toast.error(e.message || "Download failed");
                            }
                          }}
                        >
                          <Download className="mr-1 h-3.5 w-3.5" /> XML
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            try {
                              await api.tally.downloadManifest(b.id, `${b.batchNumber}-manifest.csv`);
                              toast.success("Manifest Downloaded");
                            } catch (e: any) {
                              toast.error(e.message || "Download failed");
                            }
                          }}
                        >
                          Manifest
                        </Button>
                        {b.status !== "Imported" && (
                          <Button size="sm" onClick={() => setConfirmId(b.id)}>
                            Confirm Import
                          </Button>
                        )}
                        {b.errorCount > 0 && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => retryMutation.mutate(b.id)}
                            disabled={retryMutation.isPending}
                          >
                            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Retry Failed
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* Import Confirmation Form Modal */}
      {confirmId && (
        <Card title="Record Tally Import Outcome">
          <p className="mb-3 text-sm text-muted-foreground">
            Enter the exact record counts reported by TallyPrime after importing this XML file.
            WhizUnik only marks records as <strong>Imported</strong> upon user confirmation.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(["created", "altered", "skipped", "failed"] as const).map((k) => (
              <div key={k}>
                <Label htmlFor={`confirm-${k}`} className="capitalize">
                  {k} Count
                </Label>
                <Input
                  id={`confirm-${k}`}
                  type="number"
                  min={0}
                  value={counts[k]}
                  onChange={(e) => setCounts({ ...counts, [k]: e.target.value })}
                  placeholder="0"
                />
              </div>
            ))}
          </div>
          <div className="mt-3">
            <Label htmlFor="confirm-notes">Remarks / Tally Voucher References</Label>
            <Input
              id="confirm-notes"
              value={counts.notes}
              onChange={(e) => setCounts({ ...counts, notes: e.target.value })}
              placeholder="e.g. Imported successfully into Tally 2026-27 book; no errors reported"
            />
          </div>
          <div className="mt-4 flex gap-2">
            <Button onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}>
              {confirmMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              Save Import Confirmation
            </Button>
            <Button variant="outline" onClick={() => setConfirmId(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* Expanded Batch Records Detail Modal */}
      {expanded && (
        <Card
          title={`Batch Records: ${detailQuery.data?.batch?.batchNumber ?? ""}`}
          action={
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await api.tally.downloadErrors(expanded, `${detailQuery.data?.batch?.batchNumber}-errors.csv`);
                    toast.success("Error Report CSV Downloaded");
                  } catch (e: any) {
                    toast.error(e.message || "Download failed");
                  }
                }}
              >
                <FileSpreadsheet className="mr-1 h-3.5 w-3.5" /> Download Report CSV
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setExpanded(null)}>
                Close
              </Button>
            </div>
          }
        >
          {detailQuery.isLoading ? (
            <div className="h-32 animate-pulse rounded-xl border border-border bg-muted/40" />
          ) : (
            <div className="max-h-80 overflow-auto rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document #</TableHead>
                    <TableHead>Party</TableHead>
                    <TableHead>Voucher Type</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Validation Messages</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(detailQuery.data?.batch?.records ?? []).map((r: any) => (
                    <TableRow key={r.sourceId}>
                      <TableCell className="font-mono text-xs font-semibold">
                        {r.docNumber || r.sourceId.slice(0, 8)}
                        <div className="text-[10px] text-muted-foreground">{r.date || "—"}</div>
                      </TableCell>
                      <TableCell className="text-xs">{r.party || "—"}</TableCell>
                      <TableCell className="text-xs">{r.voucherType}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs font-semibold">
                        {money(r.amount)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge severity={statusTone(r.status)} text={r.status} />
                      </TableCell>
                      <TableCell className="max-w-[340px] text-xs">
                        {r.errors?.map((e: string, i: number) => (
                          <div key={`e${i}`} className="text-rose-600 font-medium">
                            • {e}
                          </div>
                        ))}
                        {r.warnings?.map((w: string, i: number) => (
                          <div key={`w${i}`} className="text-amber-700 dark:text-amber-300">
                            • {w}
                          </div>
                        ))}
                        {!r.errors?.length && !r.warnings?.length && (
                          <span className="text-muted-foreground">Clean</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ─── Reverse Import Tab (Future-Ready) ───────────────────────────────────────

function ReverseImportTab() {
  const [xmlText, setXmlText] = useState("");
  const [stagedResult, setStagedResult] = useState<any | null>(null);

  const parseMutation = useMutation({
    mutationFn: () => api.tally.reverseImportParse(xmlText),
    onSuccess: (data) => {
      setStagedResult(data);
      toast.success("Tally XML Parsed & Reconciled", {
        description: `Identified ${data.totalCount} vouchers (${data.matchedCount} matched, ${data.newCount} new).`,
      });
    },
    onError: (e: any) => toast.error(e.message || "Failed to parse XML"),
  });

  return (
    <div className="space-y-5">
      <Card title="Reverse Import from TallyPrime">
        <p className="mb-4 text-sm text-muted-foreground">
          Import voucher, payment, and statutory tax details (IRN, e-Way Bill, Ack) from Tally back into WhizUnik.
          The staging parser reconciles vouchers without overwriting operational records silently.
        </p>

        <div className="space-y-3">
          <Label htmlFor="tally-xml-input">Paste Tally Export XML or Upload File</Label>
          <textarea
            id="tally-xml-input"
            rows={6}
            className="w-full rounded-xl border border-input bg-background p-3 font-mono text-xs"
            placeholder="Paste <ENVELOPE>...</ENVELOPE> from Tally export..."
            value={xmlText}
            onChange={(e) => setXmlText(e.target.value)}
          />
          <div className="flex gap-2">
            <Button onClick={() => parseMutation.mutate()} disabled={!xmlText.trim() || parseMutation.isPending}>
              {parseMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Parse & Reconcile with WhizUnik
            </Button>
            <Button variant="outline" onClick={() => setXmlText("")}>
              Clear
            </Button>
          </div>
        </div>

        {stagedResult && (
          <div className="mt-6 space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
              <div className="rounded-lg border border-border p-3">
                <span className="text-muted-foreground">Total Vouchers</span>
                <div className="text-lg font-bold">{stagedResult.totalCount}</div>
              </div>
              <div className="rounded-lg border border-emerald-300 bg-emerald-50/50 p-3">
                <span className="text-emerald-800">Matched to WhizUnik</span>
                <div className="text-lg font-bold text-emerald-700">{stagedResult.matchedCount}</div>
              </div>
              <div className="rounded-lg border border-blue-300 bg-blue-50/50 p-3">
                <span className="text-blue-800">New in Tally</span>
                <div className="text-lg font-bold text-blue-700">{stagedResult.newCount}</div>
              </div>
              <div className="rounded-lg border border-amber-300 bg-amber-50/50 p-3">
                <span className="text-amber-800">Differences / Changed</span>
                <div className="text-lg font-bold text-amber-700">{stagedResult.changedCount}</div>
              </div>
            </div>

            <div className="max-h-72 overflow-auto rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Voucher #</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Party</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>IRN / EWB</TableHead>
                    <TableHead>Classification</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stagedResult.vouchers?.map((v: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs font-semibold">{v.voucherNumber || v.reference}</TableCell>
                      <TableCell className="text-xs">{v.voucherType}</TableCell>
                      <TableCell className="text-xs">{v.partyName}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs font-bold">{money(v.amount)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {v.irn ? <Badge variant="outline" className="text-[10px]">IRN Set</Badge> : "—"}
                        {v.ewayBillNo ? <Badge variant="outline" className="ml-1 text-[10px]">EWB Set</Badge> : null}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={v.classification === "Matched" ? "default" : "secondary"}
                          className="text-[10px]"
                        >
                          {v.classification}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Configuration & Ledger Mapping Tab ─────────────────────────────────────

function ConfigTab({
  data,
  loading,
  onSaved,
}: {
  data: any;
  loading: boolean;
  onSaved: () => void;
}) {
  const config = data?.config ?? {};
  const [form, setForm] = useState<any>(() => ({
    companyName: config.companyName ?? "",
    homeState: config.homeState ?? "",
    gstin: config.gstin ?? "",
    gstRegistrationType: config.gstRegistrationType ?? "Regular",
    godownName: config.godownName ?? "",
    defaultUnit: config.defaultUnit ?? "pics",
    stockGroup: config.stockGroup ?? "Primary",
    batchName: config.batchName ?? "Primary Batch",
    gstApplicableFrom: config.gstApplicableFrom ?? "2026-10-01",
    allowDuplicateReExport: !!config.allowDuplicateReExport,
    mappings: { ...(data?.suggested ?? {}), ...(config.mappings ?? {}) },
  }));

  useEffect(() => {
    if (loading) return;
    const latest = data?.config ?? {};
    setForm({
      companyName: latest.companyName ?? "",
      homeState: latest.homeState ?? "",
      gstin: latest.gstin ?? "",
      gstRegistrationType: latest.gstRegistrationType ?? "Regular",
      godownName: latest.godownName ?? "",
      defaultUnit: latest.defaultUnit ?? "pics",
      stockGroup: latest.stockGroup ?? "Primary",
      batchName: latest.batchName ?? "Primary Batch",
      gstApplicableFrom: latest.gstApplicableFrom ?? "2026-10-01",
      allowDuplicateReExport: !!latest.allowDuplicateReExport,
      mappings: { ...(data?.suggested ?? {}), ...(latest.mappings ?? {}) },
    });
  }, [data, loading]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.tally.saveConfig({
        ...form,
        companyName: String(form.companyName || "").replace(/\s+/g, " ").trim(),
        homeState: String(form.homeState || "").replace(/\s+/g, " ").trim(),
        gstin: String(form.gstin || "").replace(/\s+/g, "").trim().toUpperCase(),
        godownName: String(form.godownName || "").replace(/\s+/g, " ").trim(),
        defaultUnit: String(form.defaultUnit || "").replace(/\s+/g, " ").trim(),
        stockGroup: String(form.stockGroup || "").replace(/\s+/g, " ").trim(),
        batchName: String(form.batchName || "").replace(/\s+/g, " ").trim(),
        mappings: Object.fromEntries(
          Object.entries(form.mappings || {}).map(([key, value]) => [
            key,
            String(value ?? "").replace(/\s+/g, " ").trim(),
          ]),
        ),
      }),
    onSuccess: (savedResponse) => {
      const saved = savedResponse?.config ?? null;
      if (saved) {
        setForm({
          companyName: saved.companyName ?? "",
          homeState: saved.homeState ?? "",
          gstin: saved.gstin ?? "",
          gstRegistrationType: saved.gstRegistrationType ?? "Regular",
          godownName: saved.godownName ?? "",
          defaultUnit: saved.defaultUnit ?? "pics",
          stockGroup: saved.stockGroup ?? "Primary",
          batchName: saved.batchName ?? "Primary Batch",
          gstApplicableFrom: saved.gstApplicableFrom ?? "2026-10-01",
          allowDuplicateReExport: !!saved.allowDuplicateReExport,
          mappings: { ...(data?.suggested ?? {}), ...(saved.mappings ?? {}) },
        });
      }
      toast.success("Tally Configuration Saved", {
        description: "Company details and ledger mappings updated.",
      });
      onSaved();
    },
    onError: (e: any) => toast.error(e.message || "Could not save configuration"),
  });

  function setField(key: string, value: any) {
    setForm((f: any) => ({ ...f, [key]: value }));
  }
  function setMapping(key: string, value: string) {
    setForm((f: any) => ({ ...f, mappings: { ...f.mappings, [key]: value } }));
  }

  if (loading) {
    return <div className="h-64 animate-pulse rounded-2xl border border-border bg-muted/40" />;
  }

  const sections = Array.from(new Set(MAPPING_FIELDS.map((f) => f.section)));

  return (
    <div className="space-y-6">
      <Card
        title="Tally Environment & Target Company"
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setForm((f: any) => ({
                ...f,
                mappings: { ...(data?.suggested ?? {}), ...f.mappings },
              }))
            }
          >
            Load Standard Tally Names
          </Button>
        }
      >
        <p className="mb-4 text-sm text-muted-foreground">
          WhizUnik embeds your configured Tally company name, godown name, and ledger titles into every generated XML
          tag. Nothing is hardcoded.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label htmlFor="companyName" className="font-semibold text-foreground">
              Target Tally Company Name *
            </Label>
            <Input
              id="companyName"
              value={form.companyName}
              onChange={(e) => setField("companyName", e.target.value)}
              placeholder="e.g. Whizunik"
              className="mt-1 border-primary/50 font-semibold"
            />
            <span className="text-[11px] text-muted-foreground">Must match SVCURRENTCOMPANY in TallyPrime exactly</span>
          </div>

          <div>
            <Label htmlFor="homeState" className="font-semibold text-foreground">
              Company GST Home State *
            </Label>
            <select
              id="homeState"
              value={form.homeState}
              onChange={(e) => setField("homeState", e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-medium"
            >
              <option value="">Select Company Home State</option>
              {INDIAN_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-muted-foreground">Decides CGST+SGST vs IGST vs UTGST</span>
          </div>

          <div>
            <Label htmlFor="godownName">Tally Godown / Warehouse Name *</Label>
            <Input
              id="godownName"
              value={form.godownName}
              onChange={(e) => setField("godownName", e.target.value)}
              placeholder="e.g. Main Warehouse"
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="stockGroup">Stock Group</Label>
            <Input
              id="stockGroup"
              value={form.stockGroup}
              onChange={(e) => setField("stockGroup", e.target.value)}
              placeholder="Primary"
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="batchName">Default Stock Batch Name</Label>
            <Input
              id="batchName"
              value={form.batchName}
              onChange={(e) => setField("batchName", e.target.value)}
              placeholder="Primary Batch"
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="defaultUnit">Default Unit</Label>
            <Input
              id="defaultUnit"
              value={form.defaultUnit}
              onChange={(e) => setField("defaultUnit", e.target.value)}
              placeholder="pics"
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="gstin">Company GSTIN</Label>
            <Input
              id="gstin"
              value={form.gstin}
              onChange={(e) => setField("gstin", e.target.value)}
              placeholder="09AABCU9603R1ZM"
              className="mt-1 font-mono text-xs uppercase"
            />
          </div>

          <div>
            <Label htmlFor="gstApplicableFrom">GST / HSN Applicable Date</Label>
            <Input
              id="gstApplicableFrom"
              type="date"
              value={form.gstApplicableFrom}
              onChange={(e) => setField("gstApplicableFrom", e.target.value)}
              className="mt-1"
            />
          </div>

          <div className="flex items-center gap-2 pt-6">
            <input
              id="allow-dup"
              type="checkbox"
              checked={form.allowDuplicateReExport}
              onChange={(e) => setField("allowDuplicateReExport", e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <Label htmlFor="allow-dup" className="cursor-pointer text-xs text-muted-foreground">
              Allow duplicate re-exports by default (bypasses idempotency hash)
            </Label>
          </div>
        </div>
      </Card>

      {/* Ledger Mappings */}
      {sections.map((section) => (
        <Card key={section} title={section}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {MAPPING_FIELDS.filter((f) => f.section === section).map((f) => (
              <div key={f.key}>
                <Label htmlFor={`map-${f.key}`} className="text-xs">
                  {f.label}
                </Label>
                <Input
                  id={`map-${f.key}`}
                  value={form.mappings?.[f.key] ?? ""}
                  onChange={(e) => setMapping(f.key, e.target.value)}
                  placeholder="Exact Tally ledger / group name"
                  className="mt-1 text-xs"
                />
              </div>
            ))}
          </div>
        </Card>
      ))}

      <div className="flex justify-end pt-2">
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} size="lg">
          {saveMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="mr-2 h-4 w-4" />
          )}
          Save Configuration & Mappings
        </Button>
      </div>
    </div>
  );
}

// ─── Import Instructions Screen ─────────────────────────────────────────────

function InstructionsTab({ onGoConfirm }: { onGoConfirm: () => void }) {
  const { data } = useQuery({
    queryKey: ["tally-instructions"],
    queryFn: () => api.tally.instructions(),
  });
  const steps: string[] = data?.steps ?? [];

  return (
    <div className="space-y-6">
      <Card title="How to Import XML into Hosted TallyPrime">
        <ol className="space-y-3.5 pt-2">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 font-bold text-blue-800 dark:bg-blue-950 dark:text-blue-300 text-xs">
                {i + 1}
              </span>
              <span className="pt-0.5 text-foreground leading-relaxed">{s}</span>
            </li>
          ))}
        </ol>

        <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <div className="flex items-center gap-2 font-bold text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-700" /> Crucial Operational Reminders
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong>Always take a backup</strong> in TallyPrime before importing any batch.
            </li>
            <li>
              <strong>Import Masters first:</strong> Customers, Suppliers, Stock Items, and Units must be imported
              before transaction vouchers so vouchers can resolve ledger names.
            </li>
            <li>
              <strong>Download does not mean Imported:</strong> WhizUnik tracks exported files as Downloaded until you
              confirm the actual Tally counts.
            </li>
          </ul>
        </div>

        <div className="mt-4 flex justify-end">
          <Button onClick={onGoConfirm}>
            <CheckCircle2 className="mr-2 h-4 w-4" /> Go to Export History to Record Import
          </Button>
        </div>
      </Card>
    </div>
  );
}
