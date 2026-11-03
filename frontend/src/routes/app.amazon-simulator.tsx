import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  FileText,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Undo2,
  Wallet,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api-client";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@/components/ui";

export const Route = createFileRoute("/app/amazon-simulator")({
  component: AmazonSimulatorPage,
});

const sim = api.amazonSimulator;

const ERROR_SIMULATIONS: Array<{ kind: string; label: string }> = [
  { kind: "unmapped_sku", label: "Unmapped SKU" },
  { kind: "insufficient_stock", label: "Insufficient stock" },
  { kind: "missing_invoice", label: "Missing invoice" },
  { kind: "dispatch_failure", label: "Dispatch failure" },
  { kind: "duplicate_order", label: "Duplicate order" },
  { kind: "duplicate_return", label: "Duplicate return" },
  { kind: "api_failure", label: "API failure" },
  { kind: "settlement_mismatch", label: "Settlement mismatch" },
  { kind: "missing_tracking", label: "Missing tracking number" },
];

const FULFILMENT_TYPES = [
  { value: "EasyShip", label: "Easy Ship" },
  { value: "SelfShip", label: "Self Ship" },
  { value: "SellerFlex", label: "Seller Flex" },
  { value: "FBA", label: "FBA" },
];

const RETURN_STATUS_LABEL: Record<string, string> = {
  ReturnInitiated: "Return Initiated",
  InTransit: "In Transit",
  Received: "Received",
  UnderInspection: "Under Inspection",
  Accepted: "Accepted",
  PartiallyAccepted: "Partially Accepted",
  Rejected: "Rejected",
  CreditNoteCreated: "Credit Note Created",
  RefundConfirmed: "Refund Confirmed",
  Closed: "Closed",
};

const DISPOSITIONS = [
  "Returned",
  "Recovered through claim",
  "Written off with approval",
  "Pending decision",
];

const inr = (n: number | null | undefined) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";

function tone(status?: string | null): string {
  const s = String(status ?? "");
  if (/Mapping Required|Awaiting Stock|Open|DISPUTED|Rejected|failed|MISMATCH/i.test(s))
    return "bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300";
  if (/Pending|Awaiting|Initiated|In Transit|picking|packed|EXPECTED|Inspection|Received$/i.test(s))
    return "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300";
  if (
    /Delivered|Closed|Resolved|RECEIVED|Refunded|Confirmed|success|Accepted|Shipped|Received|reconciled/i.test(
      s,
    )
  )
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300";
  return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
}

function Status({ value }: { value?: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${tone(value)}`}
    >
      {value}
    </span>
  );
}

function DemoBadge() {
  return (
    <Badge className="border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
      DEMO · MARKETPLACE-DEMO
    </Badge>
  );
}

function Section({
  title,
  hint,
  children,
  right,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        {right}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

function Table({
  head,
  rows,
  empty,
}: {
  head: string[];
  rows: React.ReactNode[][];
  empty: string;
}) {
  return (
    <table className="w-full text-xs">
      <thead className="bg-muted/40 text-left text-muted-foreground">
        <tr>
          {head.map((h) => (
            <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={head.length} className="px-3 py-6 text-center text-muted-foreground">
              {empty}
            </td>
          </tr>
        ) : (
          rows.map((r, i) => (
            <tr key={i} className="border-t align-top">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2">
                  {c}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

const emptyOrderForm = (defaults: any) => ({
  amazonOrderId: "",
  amazonSku: "AMZ-GLV-BLU-M",
  internalSku: "GLV-BLU-M",
  productName: "Demo Gloves",
  colour: "Blue",
  size: "Medium",
  quantity: "10",
  sellingPrice: "500",
  discount: "0",
  taxRate: "5",
  addressLine1: defaults?.address?.addressLine1 ?? "",
  city: defaults?.address?.city ?? "",
  state: defaults?.address?.state ?? "",
  postalCode: defaults?.address?.postalCode ?? "",
  expectedDispatchDate: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
  fulfilmentType: "EasyShip",
  delayInvoice: false,
});

export function AmazonSimulatorPage() {
  const queryClient = useQueryClient();
  const {
    data: state,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["amazon-simulator-state"],
    queryFn: () => sim.getState(),
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [journey, setJourney] = useState<any>(null);
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderForm, setOrderForm] = useState(() => emptyOrderForm(null));
  const [inspect, setInspect] = useState<any>(null);
  const [disposition, setDisposition] = useState<any>(null);
  const [retry, setRetry] = useState<any>(null);
  const [errorKind, setErrorKind] = useState(ERROR_SIMULATIONS[0].kind);
  const [mapping, setMapping] = useState({ channelSku: "", whizunikSku: "GLV-RED-L" });
  const [stockForm, setStockForm] = useState({ sku: "TS-BLK-M", quantity: "20" });

  const act = async (
    key: string,
    fn: () => Promise<any>,
    success: string | ((r: any) => string),
  ) => {
    setBusy(key);
    try {
      const r = await fn();
      toast.success(typeof success === "function" ? success(r) : success);
      return r;
    } catch (e: any) {
      toast.error(e?.message ?? "Action failed");
      return null;
    } finally {
      setBusy(null);
      queryClient.invalidateQueries({ queryKey: ["amazon-simulator-state"] });
    }
  };

  const s: any = state ?? {};
  const orders: any[] = s.orders ?? [];
  const returns: any[] = s.returns ?? [];
  const openExceptions = (s.exceptions ?? []).filter(
    (e: any) => e.currentStatus === "Open" || e.currentStatus === "InProgress",
  );
  const invoiceById = useMemo(
    () => new Map((s.invoices ?? []).map((i: any) => [i.id, i])),
    [s.invoices],
  );
  const refundById = useMemo(
    () => new Map((s.refunds ?? []).map((r: any) => [r.id, r])),
    [s.refunds],
  );
  const catalogue: any[] = s.defaults?.catalogue ?? [];

  const pickSku = (amazonSku: string) => {
    const c = catalogue.find((x) => x.amazonSku === amazonSku);
    setOrderForm((f) =>
      c
        ? {
            ...f,
            amazonSku,
            internalSku: c.sku,
            productName: c.name,
            colour: c.colour,
            size: c.size,
            sellingPrice: String(c.price),
            taxRate: String(c.gstRate),
          }
        : { ...f, amazonSku },
    );
  };

  const submitOrder = async () => {
    const f = orderForm;
    const r = await act(
      "order",
      () =>
        sim.createOrder({
          amazonOrderId: f.amazonOrderId.trim() || undefined,
          amazonSku: f.amazonSku.trim(),
          internalSku: f.internalSku.trim() || null,
          productName: f.productName,
          colour: f.colour || null,
          size: f.size || null,
          quantity: Number(f.quantity),
          sellingPrice: Number(f.sellingPrice),
          discount: Number(f.discount) || 0,
          taxRate: Number(f.taxRate) || 0,
          deliveryAddress: {
            addressLine1: f.addressLine1,
            addressLine2: null,
            city: f.city,
            state: f.state,
            postalCode: f.postalCode,
            country: "IN",
          },
          expectedDispatchDate: f.expectedDispatchDate || null,
          fulfilmentType: f.fulfilmentType,
          delayInvoice: f.delayInvoice,
        }),
      (o) => `${o.amazonOrderId}: ${o.whizunikStatus}`,
    );
    if (r) setOrderOpen(false);
  };

  const nextReturnStep = (r: any): { label: string; run: () => void } | null => {
    const step = (action: string, label: string, body: any = {}) => ({
      label,
      run: () =>
        act(
          `ret-${r.id}`,
          () => sim.returnAction(r.id, action, body),
          `${r.returnNumber}: ${label}`,
        ),
    });
    switch (r.returnStatus) {
      case "ReturnInitiated":
        return step("in_transit", "Mark in transit");
      case "InTransit":
        return step("received", "Goods received");
      case "Received":
        return step("under_inspection", "Start inspection");
      case "UnderInspection":
        return {
          label: "Record inspection",
          run: () =>
            setInspect({
              ret: r,
              accepted: String(r.quantityReturned),
              damaged: "0",
              missing: "0",
              notes: "",
            }),
        };
      case "Accepted":
      case "PartiallyAccepted":
        return r.creditNoteId ? null : step("credit_note", "Create credit note");
      default:
        return null;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the demo tenant…
      </div>
    );
  }
  if (error)
    return (
      <div className="p-8 text-sm text-rose-600">
        Could not load the simulator: {(error as Error).message}
      </div>
    );

  const isBusy = (k: string) => busy === k;

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">Amazon Demo Simulator</h1>
            <DemoBadge />
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Simulated Amazon orders run through the real WhizUnik Sales Order, inventory ledger,
            warehouse task, dispatch, return, credit note and settlement workflows — inside the
            isolated demo tenant. Live customers, stock and documents are never touched.
          </p>
        </div>
      </div>

      {/* Required demo buttons */}
      <div className="flex flex-wrap gap-2 rounded-lg border bg-card p-3">
        <Button
          size="sm"
          onClick={() => {
            setOrderForm(emptyOrderForm(s.defaults));
            setOrderOpen(true);
          }}
        >
          <Plus className="mr-1 h-4 w-4" /> Add Demo Amazon Order
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!!busy}
          onClick={async () => {
            const r = await act(
              "journey",
              () => sim.runFullJourney(),
              (j) =>
                j.completed ? "Full demo journey completed" : "Journey stopped at a failed step",
            );
            if (r) setJourney(r);
          }}
        >
          {isBusy("journey") ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-1 h-4 w-4" />
          )}{" "}
          Run Full Demo Journey
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!!busy}
          onClick={() =>
            act(
              "ret",
              () => sim.createReturn(),
              (r) => `${r.returnNumber} created`,
            )
          }
        >
          <Undo2 className="mr-1 h-4 w-4" /> Create Demo Return
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!!busy}
          onClick={() =>
            act(
              "dret",
              () => sim.createDamagedReturn(),
              (r) =>
                `${r.returnNumber}: ${r.quantityAccepted} resalable, ${r.quantityDamaged} damaged`,
            )
          }
        >
          <AlertTriangle className="mr-1 h-4 w-4" /> Create Damaged Return
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!!busy}
          onClick={() =>
            act(
              "refund",
              () => sim.simulateRefund(),
              (r) => `Refund ${r.refundReference} recorded`,
            )
          }
        >
          <Wallet className="mr-1 h-4 w-4" /> Simulate Refund
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!!busy}
          onClick={() =>
            act(
              "settle",
              () => sim.simulateSettlement(),
              (r) => `${r.settlementReference}: net ${inr(r.netSettlementExpected)}`,
            )
          }
        >
          <FileText className="mr-1 h-4 w-4" /> Simulate Settlement
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!!busy}
          onClick={() =>
            act(
              "api",
              () => sim.simulateError("api_failure"),
              (r) => `API failure logged for ${r.affectedOrder}`,
            )
          }
        >
          <XCircle className="mr-1 h-4 w-4" /> Simulate API Failure
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!!busy || openExceptions.length === 0}
          onClick={() => setRetry({ ex: openExceptions[0], mapToSku: "GLV-RED-L", addStock: "20" })}
        >
          <RefreshCw className="mr-1 h-4 w-4" /> Retry Failed Event
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={!!busy}
          onClick={() => {
            if (
              window.confirm(
                "Reset the demo tenant (MARKETPLACE-DEMO)? Only demo records are deleted; live data is not affected.",
              )
            ) {
              act(
                "reset",
                () => sim.resetBaseline(),
                (r) => `Demo baseline reset (${r.deletedRecords} demo records cleared)`,
              );
              setJourney(null);
            }
          }}
        >
          <RotateCcw className="mr-1 h-4 w-4" /> Reset Demo Baseline
        </Button>
      </div>

      {/* Journey */}
      {journey && (
        <Section
          title="Full demo journey"
          hint={`${journey.amazonOrderId} — every line read back from the records it created`}
          right={<Status value={journey.completed ? "success" : "failed"} />}
        >
          <ol className="divide-y text-xs">
            {journey.steps.map((st: any, i: number) => (
              <li key={i} className="flex gap-3 px-4 py-2">
                {st.status === "success" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                )}
                <span className="w-48 shrink-0 font-medium">{st.step}</span>
                <span className="text-muted-foreground">{st.detail}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {/* Stock */}
      <Section
        title="Main inventory (demo tenant ledger)"
        hint="Stock is reserved when an order is received and reduced only at dispatch. Damaged returns sit under inspection and are never available."
      >
        <Table
          head={[
            "SKU",
            "Product",
            "Colour / size",
            "Warehouse",
            "Physical",
            "Reserved",
            "Available",
            "Under inspection",
          ]}
          empty="No demo stock — reset the baseline."
          rows={(s.stock ?? []).map((p: any) => [
            <span className="font-mono">{p.sku}</span>,
            p.name,
            [p.colour, p.size].filter(Boolean).join(" / "),
            p.warehouse,
            <b>{p.physicalStock}</b>,
            p.reservedStock,
            <b className="text-emerald-700 dark:text-emerald-400">{p.availableStock}</b>,
            p.underInspection,
          ])}
        />
        <div className="flex flex-wrap items-end gap-2 border-t px-4 py-2 text-xs">
          <Boxes className="mb-2 h-4 w-4 text-muted-foreground" />
          <div>
            <Label className="text-[11px]">Receive stock — SKU</Label>
            <select
              className="h-8 rounded-md border bg-background px-2"
              value={stockForm.sku}
              onChange={(e) => setStockForm({ ...stockForm, sku: e.target.value })}
            >
              {(s.stock ?? []).map((p: any) => (
                <option key={p.sku}>{p.sku}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-[11px]">Qty</Label>
            <Input
              className="h-8 w-20"
              value={stockForm.quantity}
              onChange={(e) => setStockForm({ ...stockForm, quantity: e.target.value })}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy}
            onClick={() =>
              act(
                "stock",
                () => sim.addStock(stockForm.sku, Number(stockForm.quantity)),
                `Received ${stockForm.quantity} × ${stockForm.sku}`,
              )
            }
          >
            Add demo stock
          </Button>
        </div>
      </Section>

      {/* Orders / Marketplace Sales Orders */}
      <Section
        title="Amazon orders → Marketplace Sales Orders"
        hint="WhizUnik status and simulated Amazon status are tracked separately."
      >
        <Table
          head={[
            "Amazon order",
            "WhizUnik SO",
            "Product",
            "Qty / price",
            "Delivery",
            "Reservation",
            "Invoice",
            "Dispatch",
            "WhizUnik status",
            "Amazon status",
            "Courier / AWB",
            "Actions",
            "Documents",
          ]}
          empty="No demo orders yet — add one or run the full journey."
          rows={orders.map((o) => {
            const k = (a: string) => `${a}-${o.amazonOrderId}`;
            const actions: React.ReactNode[] = [];
            const btn = (key: string, label: string, fn: () => Promise<any>) => (
              <Button
                key={key}
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                disabled={!!busy}
                onClick={() => act(k(key), fn, `${o.amazonOrderId}: ${label}`)}
              >
                {isBusy(k(key)) && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                {label}
              </Button>
            );
            if (o.whizunikStatus === "Invoice Pending")
              actions.push(
                btn("inv", "Receive Amazon invoice", () => sim.receiveInvoice(o.amazonOrderId)),
              );
            if (o.whizunikStatus === "Invoice Received" && o.dispatchStatus === "picking")
              actions.push(btn("pack", "Mark packed", () => sim.markPacked(o.amazonOrderId)));
            if (o.whizunikStatus === "Packed")
              actions.push(
                btn("dsp", "Confirm Demo Dispatch", () => sim.confirmDispatch(o.amazonOrderId)),
              );
            if (o.dispatchStatus === "in_transit")
              actions.push(btn("dlv", "Mark Delivered", () => sim.markDelivered(o.amazonOrderId)));
            if (o.shippedAt && !o.returnId) {
              actions.push(btn("ret", "Return", () => sim.createReturn(o.amazonOrderId)));
              actions.push(
                btn("dret", "Damaged return", () => sim.createDamagedReturn(o.amazonOrderId)),
              );
            }
            if (o.shippedAt && !o.settlementId)
              actions.push(btn("set", "Settle", () => sim.simulateSettlement(o.amazonOrderId)));
            const doc = (kind: "invoice" | "packing-slip" | "settlement", label: string) => (
              <button
                key={kind}
                className="block text-left text-[11px] text-primary underline-offset-2 hover:underline"
                onClick={() =>
                  sim.openDocument(kind, o.amazonOrderId).catch((e) => toast.error(e.message))
                }
              >
                {label}
              </button>
            );
            return [
              <div>
                <div className="font-mono font-medium">{o.amazonOrderId}</div>
                <div className="text-[11px] text-muted-foreground">
                  {o.fulfilmentType} · {o.orderDate}
                </div>
              </div>,
              o.salesOrderNumber ? (
                <div>
                  <div className="font-mono">{o.salesOrderNumber}</div>
                  <div className="text-[11px] text-muted-foreground">{o.salesOrderStatus}</div>
                </div>
              ) : (
                "—"
              ),
              <div>
                <div>{o.productName}</div>
                <div className="font-mono text-[11px] text-muted-foreground">
                  {o.amazonSku} → {o.internalSku ?? "unmapped"}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {[o.colour, o.size].filter(Boolean).join(" / ")}
                </div>
              </div>,
              <div className="whitespace-nowrap">
                <div>
                  {o.quantity} × {inr(o.sellingPrice)}
                </div>
                {o.discount > 0 && (
                  <div className="text-[11px] text-muted-foreground">
                    − {inr(o.discount)} discount
                  </div>
                )}
                <div className="font-medium">{inr(o.orderValue)}</div>
                <div className="text-[11px] text-muted-foreground">
                  GST {o.taxInformation?.taxRate}% incl.
                </div>
              </div>,
              <div className="max-w-[180px]">
                <div className="text-[11px]">{o.deliveryAddressText}</div>
                <div className="text-[11px] text-muted-foreground">
                  Dispatch by {o.expectedDispatchDate ?? "—"}
                </div>
              </div>,
              <span className="text-[11px]">{o.reservation}</span>,
              <div>
                <Status
                  value={
                    o.invoiceStatus === "InvoiceReceived"
                      ? "Received"
                      : o.invoiceStatus === "AwaitingAmazonInvoice"
                        ? "Awaiting Amazon Invoice"
                        : o.invoiceStatus
                  }
                />
                {o.invoiceNumber && (
                  <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                    {o.invoiceNumber} · Amazon
                  </div>
                )}
              </div>,
              <div>
                <Status value={o.dispatchStatus} />
                {o.dispatchNumber && (
                  <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                    {o.dispatchNumber}
                  </div>
                )}
              </div>,
              <Status value={o.whizunikStatus} />,
              <Status value={o.amazonOrderStatus} />,
              o.courier ? (
                <div className="whitespace-nowrap text-[11px]">
                  <div>{o.courier}</div>
                  <div className="font-mono">{o.awbNumber}</div>
                  <div className="text-muted-foreground">{o.trackingStatus}</div>
                  {o.deliveredAt && (
                    <div className="text-muted-foreground">Delivered {when(o.deliveredAt)}</div>
                  )}
                </div>
              ) : (
                "—"
              ),
              <div className="flex flex-col gap-1">
                {actions.length ? actions : <span className="text-muted-foreground">—</span>}
              </div>,
              <div className="space-y-0.5">
                {o.invoiceNumber && doc("invoice", "Amazon invoice (PDF)")}
                {o.dispatchNumber && doc("packing-slip", "Packing slip (PDF)")}
                {o.settlementId && doc("settlement", "Settlement report (PDF)")}
              </div>,
            ];
          })}
        />
      </Section>

      {/* Warehouse tasks */}
      <Section
        title="Warehouse tasks"
        hint="Opened once the Sales Order is reserved and the Amazon invoice record is received."
      >
        <Table
          head={["Dispatch", "Stage", "Required action", "Owner", "Deadline", "Status", "Updated"]}
          empty="No warehouse tasks yet."
          rows={(s.warehouseTasks ?? []).map((t: any) => [
            <span className="font-mono">{t.docNumber}</span>,
            t.stage,
            <span className="text-[11px]">{t.requiredAction}</span>,
            t.ownerRole,
            t.dueDate ?? "—",
            <Status value={t.status === "open" ? "Open task" : "Done"} />,
            when(t.updatedAt),
          ])}
        />
      </Section>

      {/* Returns */}
      <Section
        title="Returns"
        hint="Notification → received → inspection → accepted / partial / rejected → stock decision → credit note → refund reference → closed."
      >
        <Table
          head={[
            "Return",
            "Links",
            "SKU",
            "Returned",
            "Resalable / damaged / missing",
            "Reason",
            "Status",
            "Credit note / refund",
            "Damaged units",
            "Next step",
          ]}
          empty="No demo returns yet."
          rows={returns.map((r) => {
            const next = nextReturnStep(r);
            const refund: any = r.refundId ? refundById.get(r.refundId) : null;
            const canClose =
              r.returnStatus !== "Closed" &&
              !["ReturnInitiated", "InTransit", "Received", "UnderInspection"].includes(
                r.returnStatus,
              );
            return [
              <span className="font-mono font-medium">{r.returnNumber}</span>,
              <div className="font-mono text-[11px]">
                <div>{r.amazonOrderId}</div>
                <div>{r.salesOrderNumber}</div>
                <div className="text-muted-foreground">{r.invoiceNumber}</div>
              </div>,
              <span className="font-mono">{r.sku}</span>,
              r.quantityReturned,
              r.returnStatus === "ReturnInitiated" ||
              r.returnStatus === "InTransit" ||
              r.returnStatus === "Received" ||
              r.returnStatus === "UnderInspection"
                ? "—"
                : `${r.quantityAccepted} / ${r.quantityDamaged} / ${r.quantityMissing}`,
              <span className="text-[11px]">{r.returnReason}</span>,
              <Status value={RETURN_STATUS_LABEL[r.returnStatus] ?? r.returnStatus} />,
              <div className="font-mono text-[11px]">
                <div>{r.creditNoteNumber ?? "No credit note"}</div>
                <div className="text-muted-foreground">
                  {refund
                    ? `${r.refundReference} · ${inr(refund.amount)}`
                    : (r.refundReference ?? "No refund")}
                </div>
              </div>,
              r.quantityDamaged > 0 ? (
                <div className="text-[11px]">
                  <Status value={r.damagedDisposition ?? "Decision needed"} />
                  {r.damagedDisposition !== "Returned" &&
                    r.damagedDisposition !== "Recovered through claim" &&
                    r.damagedDisposition !== "Written off with approval" && (
                      <button
                        className="ml-1 text-primary hover:underline"
                        onClick={() =>
                          setDisposition({
                            ret: r,
                            disposition: "Written off with approval",
                            approvedBy: "",
                            notes: "",
                          })
                        }
                      >
                        decide
                      </button>
                    )}
                </div>
              ) : (
                "—"
              ),
              <div className="flex flex-col gap-1">
                {next && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px]"
                    disabled={!!busy}
                    onClick={next.run}
                  >
                    {next.label}
                  </Button>
                )}
                {r.creditNoteId && !r.refundId && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px]"
                    disabled={!!busy}
                    onClick={() =>
                      act(
                        `ref-${r.id}`,
                        () => sim.simulateRefund(r.id),
                        `Refund recorded for ${r.returnNumber}`,
                      )
                    }
                  >
                    Record Amazon refund
                  </Button>
                )}
                {canClose && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px]"
                    disabled={!!busy}
                    onClick={() =>
                      act(
                        `close-${r.id}`,
                        () => sim.returnAction(r.id, "close"),
                        `${r.returnNumber} closed`,
                      )
                    }
                  >
                    Close return
                  </Button>
                )}
              </div>,
            ];
          })}
        />
      </Section>

      {/* Credit notes */}
      <Section
        title="Credit notes"
        hint="Raised only for the approved financial quantity; Amazon's refund is recorded once and never repeated."
      >
        <Table
          head={[
            "Credit note",
            "Original invoice",
            "Return",
            "Accepted qty",
            "Amount",
            "Refund amount",
            "Refund reference",
            "Status",
          ]}
          empty="No credit notes yet."
          rows={(s.creditNotes ?? []).map((cn: any) => {
            const links = cn.marketplaceLinks ?? {};
            const ret = returns.find((r) => r.creditNoteId === cn.id);
            const refund: any = ret?.refundId ? refundById.get(ret.refundId) : null;
            return [
              <span className="font-mono font-medium">{cn.noteNumber}</span>,
              <span className="font-mono">{links.invoiceNumber ?? "—"}</span>,
              <span className="font-mono">{links.returnNumber ?? "—"}</span>,
              links.acceptedQty ?? "—",
              inr(cn.amount),
              refund ? inr(refund.amount) : "—",
              <span className="font-mono">{links.refundReference ?? "—"}</span>,
              <Status
                value={
                  cn.status === "refunded"
                    ? "Refunded"
                    : cn.status === "approved"
                      ? "Approved"
                      : cn.status
                }
              />,
            ];
          })}
        />
      </Section>

      {/* Settlements */}
      <Section
        title="Settlements — SIMULATED AMAZON SETTLEMENT"
        hint="Order → invoice → dispatch → return → credit note → deductions → net settlement → bank receipt."
      >
        <Table
          head={[
            "Reference",
            "Order",
            "Order value",
            "Commission",
            "Shipping",
            "Refund",
            "Other",
            "Net",
            "Bank receipt",
            "Reconciliation",
            "",
          ]}
          empty="No settlements yet."
          rows={(s.settlements ?? []).map((st: any) => {
            const b = st.breakdown ?? {};
            const rec = st.reconciliation;
            return [
              <span className="font-mono">{st.settlementReference}</span>,
              <span className="font-mono">{st.amazonOrderId}</span>,
              inr(b.orderValue),
              inr(b.commission),
              inr(b.shippingFee),
              inr(b.refundAmount),
              inr(b.otherDeductions),
              <b>{inr(st.netSettlementExpected)}</b>,
              st.bankReceipt ? (
                <div className="text-[11px]">
                  <div>{inr(st.bankReceipt.amount)}</div>
                  <div className="font-mono text-muted-foreground">
                    {st.bankReceipt.bankReference}
                  </div>
                </div>
              ) : (
                "—"
              ),
              rec ? (
                <div className="space-y-0.5 text-[11px]">
                  <Status value={rec.reconciled ? "reconciled" : "MISMATCH"} />
                  {(rec.checks ?? []).map((c: any) => (
                    <div key={c.step} className={c.ok ? "text-muted-foreground" : "text-rose-600"}>
                      {c.ok ? "✓" : "✗"} {c.step}: {c.detail}
                    </div>
                  ))}
                </div>
              ) : (
                <Status value={st.status} />
              ),
              <div className="flex flex-col gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  onClick={() =>
                    sim
                      .openDocument("settlement", st.amazonOrderId)
                      .catch((e) => toast.error(e.message))
                  }
                >
                  Report (PDF)
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[11px]"
                  disabled={!!busy}
                  onClick={() =>
                    act(
                      `rec-${st.id}`,
                      () => sim.reconcileSettlement(st.id),
                      "Reconciliation re-run",
                    )
                  }
                >
                  Reconcile
                </Button>
              </div>,
            ];
          })}
        />
      </Section>

      {/* Exceptions */}
      <Section
        title="Errors & retries"
        hint="Each simulation runs the real step; Retry Failed Event re-runs it."
        right={
          <div className="flex items-center gap-2">
            <select
              className="h-8 rounded-md border bg-background px-2 text-xs"
              value={errorKind}
              onChange={(e) => setErrorKind(e.target.value)}
            >
              {ERROR_SIMULATIONS.map((e) => (
                <option key={e.kind} value={e.kind}>
                  {e.label}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy}
              onClick={() =>
                act(
                  "err",
                  () => sim.simulateError(errorKind),
                  (r) =>
                    `${ERROR_SIMULATIONS.find((e) => e.kind === errorKind)?.label} simulated on ${r.affectedOrder}`,
                )
              }
            >
              Simulate error
            </Button>
          </div>
        }
      >
        <Table
          head={[
            "Affected order",
            "Error reason",
            "Message",
            "Retry action",
            "Current status",
            "Responsible user",
            "Retries",
            "Last attempt",
            "",
          ]}
          empty="No errors — use Simulate error to test the failure paths."
          rows={(s.exceptions ?? []).map((e: any) => [
            <span className="font-mono">{e.affectedOrder}</span>,
            e.errorReason,
            <span className="text-[11px]">{e.errorMessage}</span>,
            <span className="text-[11px]">{e.retryAction ?? "—"}</span>,
            <Status value={e.currentStatus} />,
            e.responsibleUser ?? "—",
            `${e.retryCount ?? 0}/${e.maxRetries ?? 3}`,
            when(e.lastAttempt),
            e.currentStatus === "Open" ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px]"
                disabled={!!busy}
                onClick={() => setRetry({ ex: e, mapToSku: "GLV-RED-L", addStock: "20" })}
              >
                Retry
              </Button>
            ) : (
              <span className="text-[11px] text-muted-foreground">{e.resolutionNotes}</span>
            ),
          ])}
        />
      </Section>

      {/* SKU mappings */}
      <Section
        title="SKU mappings"
        hint="An unmapped Amazon SKU stops at “SKU Mapping Required” — no reservation, no warehouse task."
      >
        <Table
          head={["Amazon SKU", "WhizUnik SKU", "Product", "Variant", "Warehouse", "Status"]}
          empty="No mappings."
          rows={(s.mappings ?? []).map((m: any) => [
            <span className="font-mono">{m.channelSku}</span>,
            <span className="font-mono">{m.whizunikSku}</span>,
            m.productName,
            m.variant,
            m.warehouse,
            <Status value={m.status} />,
          ])}
        />
        <div className="flex flex-wrap items-end gap-2 border-t px-4 py-2 text-xs">
          <div>
            <Label className="text-[11px]">Amazon SKU</Label>
            <Input
              className="h-8 w-40 font-mono"
              placeholder="AMZ-GLV-RED-L"
              value={mapping.channelSku}
              onChange={(e) => setMapping({ ...mapping, channelSku: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-[11px]">WhizUnik SKU</Label>
            <select
              className="h-8 rounded-md border bg-background px-2 font-mono"
              value={mapping.whizunikSku}
              onChange={(e) => setMapping({ ...mapping, whizunikSku: e.target.value })}
            >
              {(s.stock ?? []).map((p: any) => (
                <option key={p.sku}>{p.sku}</option>
              ))}
            </select>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy || !mapping.channelSku}
            onClick={() =>
              act(
                "map",
                () => sim.addSkuMapping(mapping.channelSku.trim(), mapping.whizunikSku),
                `${mapping.channelSku} → ${mapping.whizunikSku}`,
              )
            }
          >
            Add mapping
          </Button>
        </div>
      </Section>

      {/* Ledger + audit */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Inventory ledger (demo stock movements)">
          <Table
            head={["When", "SKU", "In / out", "Qty", "Location", "Reason", "Document"]}
            empty="No movements."
            rows={(s.ledger ?? [])
              .slice(0, 40)
              .map((m: any) => [
                when(m.createdAt),
                <span className="font-mono">{m.sku}</span>,
                <Status value={m.direction === "in" ? "IN" : "OUT"} />,
                m.quantity,
                <span className="text-[11px]">{m.warehouse}</span>,
                <span className="text-[11px]">{m.reason}</span>,
                <span className="font-mono text-[11px]">{m.linkedDocumentNumber ?? "—"}</span>,
              ])}
          />
        </Section>
        <Section title="Audit trail" hint="Every simulator event, newest first.">
          <Table
            head={["When", "Event", "Target", "By"]}
            empty="No events yet."
            rows={(s.auditTrail ?? [])
              .slice(0, 60)
              .map((a: any) => [
                when(a.createdAt),
                <span className="font-mono text-[11px]">
                  {String(a.action).replace(/^amazon_demo\./, "")}
                </span>,
                <span className="font-mono text-[11px]">{a.target}</span>,
                <span className="text-[11px]">{a.actorEmail}</span>,
              ])}
          />
        </Section>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" /> All records on this page live in tenant {s.tenantId}{" "}
        with isDemoData = true. Reset clears only that tenant.
      </p>

      {/* Add order dialog */}
      <Dialog open={orderOpen} onOpenChange={setOrderOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Add Demo Amazon Order <DemoBadge />
            </DialogTitle>
            <DialogDescription>
              Selling price is per unit and includes GST. Leave the order number blank to
              auto-number.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-3">
            {(
              [
                ["amazonOrderId", "Amazon order number", "AMZ-DEMO-…"],
                ["amazonSku", "Amazon SKU", ""],
                ["internalSku", "Internal WhizUnik SKU", ""],
                ["productName", "Product name", ""],
                ["colour", "Colour", ""],
                ["size", "Size", ""],
                ["quantity", "Quantity", ""],
                ["sellingPrice", "Selling price (₹ / unit)", ""],
                ["discount", "Discount (₹)", ""],
                ["taxRate", "Tax (GST %)", ""],
                ["expectedDispatchDate", "Expected dispatch date", ""],
              ] as const
            ).map(([key, label, placeholder]) => (
              <div key={key}>
                <Label className="text-[11px]">{label}</Label>
                <Input
                  className="h-8 text-xs"
                  type={key === "expectedDispatchDate" ? "date" : "text"}
                  placeholder={placeholder}
                  list={key === "amazonSku" ? "demo-amazon-skus" : undefined}
                  value={(orderForm as any)[key]}
                  onChange={(e) =>
                    key === "amazonSku"
                      ? pickSku(e.target.value)
                      : setOrderForm({ ...orderForm, [key]: e.target.value })
                  }
                />
              </div>
            ))}
            <div>
              <Label className="text-[11px]">Fulfilment type</Label>
              <select
                className="h-8 w-full rounded-md border bg-background px-2"
                value={orderForm.fulfilmentType}
                onChange={(e) => setOrderForm({ ...orderForm, fulfilmentType: e.target.value })}
              >
                {FULFILMENT_TYPES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2 md:col-span-3">
              <Label className="text-[11px]">Delivery address</Label>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Input
                  className="col-span-2 h-8 text-xs"
                  placeholder="Address"
                  value={orderForm.addressLine1}
                  onChange={(e) => setOrderForm({ ...orderForm, addressLine1: e.target.value })}
                />
                <Input
                  className="h-8 text-xs"
                  placeholder="City"
                  value={orderForm.city}
                  onChange={(e) => setOrderForm({ ...orderForm, city: e.target.value })}
                />
                <Input
                  className="h-8 text-xs"
                  placeholder="State"
                  value={orderForm.state}
                  onChange={(e) => setOrderForm({ ...orderForm, state: e.target.value })}
                />
                <Input
                  className="h-8 text-xs"
                  placeholder="PIN"
                  value={orderForm.postalCode}
                  onChange={(e) => setOrderForm({ ...orderForm, postalCode: e.target.value })}
                />
              </div>
            </div>
            <label className="col-span-2 flex items-center gap-2 md:col-span-3">
              <input
                type="checkbox"
                checked={orderForm.delayInvoice}
                onChange={(e) => setOrderForm({ ...orderForm, delayInvoice: e.target.checked })}
              />
              Delay the Amazon invoice (shows “Awaiting Amazon Invoice”; the warehouse task waits)
            </label>
            <datalist id="demo-amazon-skus">
              {catalogue.map((c) => (
                <option key={c.amazonSku} value={c.amazonSku} />
              ))}
            </datalist>
          </div>
          <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
            <span>
              Order value:{" "}
              {inr(
                Number(orderForm.quantity) * Number(orderForm.sellingPrice) -
                  (Number(orderForm.discount) || 0),
              )}
            </span>
            <Button size="sm" disabled={isBusy("order")} onClick={submitOrder}>
              {isBusy("order") && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Create order
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Inspection dialog */}
      <Dialog open={!!inspect} onOpenChange={(o) => !o && setInspect(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Inspection — {inspect?.ret?.returnNumber}</DialogTitle>
            <DialogDescription>
              {inspect?.ret?.quantityReturned} returned. Resalable units go back to available stock;
              damaged / rejected units stay under inspection.
            </DialogDescription>
          </DialogHeader>
          {inspect && (
            <div className="grid grid-cols-3 gap-2 text-xs">
              {(["accepted", "damaged", "missing"] as const).map((k) => (
                <div key={k}>
                  <Label className="text-[11px] capitalize">
                    {k === "accepted"
                      ? "Resalable"
                      : k === "damaged"
                        ? "Damaged / rejected"
                        : "Missing"}
                  </Label>
                  <Input
                    className="h-8"
                    value={inspect[k]}
                    onChange={(e) => setInspect({ ...inspect, [k]: e.target.value })}
                  />
                </div>
              ))}
              <div className="col-span-3">
                <Label className="text-[11px]">Inspection notes</Label>
                <Input
                  className="h-8"
                  value={inspect.notes}
                  onChange={(e) => setInspect({ ...inspect, notes: e.target.value })}
                />
              </div>
              <div className="col-span-3 flex justify-end">
                <Button
                  size="sm"
                  disabled={!!busy}
                  onClick={async () => {
                    const r = await act(
                      "inspect",
                      () =>
                        sim.returnAction(inspect.ret.id, "inspect", {
                          accepted: Number(inspect.accepted),
                          damaged: Number(inspect.damaged),
                          missing: Number(inspect.missing),
                          notes: inspect.notes || null,
                        }),
                      (x) => `${x.returnNumber}: ${RETURN_STATUS_LABEL[x.returnStatus]}`,
                    );
                    if (r) setInspect(null);
                  }}
                >
                  Save inspection
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Damaged disposition dialog */}
      <Dialog open={!!disposition} onOpenChange={(o) => !o && setDisposition(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Damaged units — {disposition?.ret?.returnNumber}</DialogTitle>
            <DialogDescription>
              {disposition?.ret?.quantityDamaged} damaged unit(s) must be marked before the return
              can close.
            </DialogDescription>
          </DialogHeader>
          {disposition && (
            <div className="space-y-2 text-xs">
              <select
                className="h-8 w-full rounded-md border bg-background px-2"
                value={disposition.disposition}
                onChange={(e) => setDisposition({ ...disposition, disposition: e.target.value })}
              >
                {DISPOSITIONS.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
              {disposition.disposition === "Written off with approval" && (
                <Input
                  className="h-8"
                  placeholder="Approved by"
                  value={disposition.approvedBy}
                  onChange={(e) => setDisposition({ ...disposition, approvedBy: e.target.value })}
                />
              )}
              <Input
                className="h-8"
                placeholder="Notes"
                value={disposition.notes}
                onChange={(e) => setDisposition({ ...disposition, notes: e.target.value })}
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={!!busy}
                  onClick={async () => {
                    const r = await act(
                      "disp",
                      () =>
                        sim.returnAction(disposition.ret.id, "disposition", {
                          disposition: disposition.disposition,
                          approvedBy: disposition.approvedBy || null,
                          notes: disposition.notes || null,
                        }),
                      (x) => `${x.quantityDamaged} unit(s): ${x.damagedDisposition}`,
                    );
                    if (r) setDisposition(null);
                  }}
                >
                  Save decision
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Retry dialog */}
      <Dialog open={!!retry} onOpenChange={(o) => !o && setRetry(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Retry failed event</DialogTitle>
            <DialogDescription>
              {retry?.ex?.affectedOrder} · {retry?.ex?.errorReason}
            </DialogDescription>
          </DialogHeader>
          {retry && (
            <div className="space-y-2 text-xs">
              {openExceptions.length > 1 && (
                <select
                  className="h-8 w-full rounded-md border bg-background px-2"
                  value={retry.ex.id}
                  onChange={(e) =>
                    setRetry({
                      ...retry,
                      ex: openExceptions.find((x: any) => x.id === e.target.value),
                    })
                  }
                >
                  {openExceptions.map((x: any) => (
                    <option key={x.id} value={x.id}>
                      {x.affectedOrder} — {x.errorReason}
                    </option>
                  ))}
                </select>
              )}
              <p className="text-muted-foreground">{retry.ex.errorMessage}</p>
              <p>
                <b>Retry action:</b> {retry.ex.retryAction}
              </p>
              {retry.ex.errorReason === "UnmappedSKU" && (
                <div>
                  <Label className="text-[11px]">Map to WhizUnik SKU first</Label>
                  <select
                    className="h-8 w-full rounded-md border bg-background px-2 font-mono"
                    value={retry.mapToSku}
                    onChange={(e) => setRetry({ ...retry, mapToSku: e.target.value })}
                  >
                    <option value="">— already mapped —</option>
                    {(s.stock ?? []).map((p: any) => (
                      <option key={p.sku}>{p.sku}</option>
                    ))}
                  </select>
                </div>
              )}
              {retry.ex.errorReason === "StockShortage" && (
                <div>
                  <Label className="text-[11px]">Receive demo stock first (qty, 0 = none)</Label>
                  <Input
                    className="h-8"
                    value={retry.addStock}
                    onChange={(e) => setRetry({ ...retry, addStock: e.target.value })}
                  />
                </div>
              )}
              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={!!busy}
                  onClick={async () => {
                    const r = await act(
                      "retry",
                      () =>
                        sim.retryError(retry.ex.id, {
                          mapToSku:
                            retry.ex.errorReason === "UnmappedSKU"
                              ? retry.mapToSku || undefined
                              : undefined,
                          addStock:
                            retry.ex.errorReason === "StockShortage"
                              ? Number(retry.addStock) || undefined
                              : undefined,
                        }),
                      (x) => `${x.exception?.affectedOrder}: ${x.exception?.currentStatus}`,
                    );
                    if (r) setRetry(null);
                  }}
                >
                  Retry now
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
