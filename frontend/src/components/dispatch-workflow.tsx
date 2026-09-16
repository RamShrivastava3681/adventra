import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Send, FileCheck, Undo2, PackageCheck, Truck, CalendarClock } from "lucide-react";

export const DispatchFlowIcons = { Truck, Send, FileCheck };
import api from "@/lib/api-client";

/**
 * Dispatch workflow forms (PDF-1):
 *  - DispatchPackingModal: warehouse fills packing + transport details and
 *    submits them to Finance ("Submit Dispatch Details to Finance").
 *  - RecordEwbModal: Finance enters the E-Way Bill number from Tally,
 *    generates it via the NIC API, or marks it "not required" with an
 *    authorised reason.
 *  - ConfirmDispatchModal: warehouse confirms the physical dispatch with
 *    actuals (date/time, vehicle, packed qty, LR number) — released for
 *    picking; inventory debits only when the status moves to Dispatched.
 *  - sendBack helper: Finance returns the order for correction (reason needed).
 */

const TRANSPORT_MODES = ["Road", "Rail", "Air", "Ship"];
const TRANSPORT_DOC_TYPES = ["LR", "GR", "AWB", "Railway Receipt", "Bill of Lading"];

function Field({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`block ${wide ? "col-span-2" : ""}`}>
      <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs outline-none focus:border-primary";

function ModalShell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="space-y-4 p-5 text-sm">{children}</div>
      </div>
    </div>
  );
}

// ─── Packing + transport form ───────────────────────────────────────────────
export function DispatchPackingModal({
  dispatch,
  onClose,
  onDone,
}: {
  dispatch: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const [f, setF] = useState({
    cartonCount: dispatch.carton_count ?? "",
    packageType: dispatch.package_type ?? "",
    grossWeight: dispatch.gross_weight ?? "",
    grossWeightUnit: dispatch.gross_weight_unit ?? "kg",
    handlingInstructions: dispatch.handling_instructions ?? "",
    internalDispatchNotes: dispatch.internal_dispatch_notes ?? "",
    plannedDispatchAt: dispatch.planned_dispatch_at?.slice(0, 10) ?? "",
    transportMode: dispatch.transport_mode ?? "Road",
    transporterName: dispatch.transporter_name ?? "",
    transporterId: dispatch.transporter_id ?? "",
    distanceKm: dispatch.distance_km ?? "",
    vehicleNumber: dispatch.vehicle_number ?? "",
    vehicleType: dispatch.vehicle_type ?? "",
    transportDocType: dispatch.transport_doc_type ?? "",
    transportDocNumber: dispatch.transport_doc_number ?? "",
    transportDocDate: dispatch.transport_doc_date ?? "",
    driverName: dispatch.driver_name ?? "",
    driverMobile: dispatch.driver_mobile ?? "",
  });
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: async (submit: boolean) => {
      const payload: any = { ...f };
      if (payload.distanceKm !== "" && payload.distanceKm != null)
        payload.distanceKm = Number(payload.distanceKm);
      if (payload.cartonCount !== "" && payload.cartonCount != null)
        payload.cartonCount = Number(payload.cartonCount);
      if (payload.grossWeight !== "" && payload.grossWeight != null)
        payload.grossWeight = Number(payload.grossWeight);
      if (submit) return api.goodsDispatches.submitToFinance(dispatch.id, payload);
      return api.goodsDispatches.update(dispatch.id, payload);
    },
    onSuccess: (_res, submit) => {
      toast.success(
        submit
          ? "Dispatch details submitted to Finance — E-Way Bill task created"
          : "Draft saved — submit when ready",
      );
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <ModalShell
      title="Prepare Dispatch Order"
      subtitle={`Packing + transport details for ${dispatch.dispatch_number} — invoice, IRN, customer and delivery details are pre-filled automatically. Warehouse enters only this section.`}
      onClose={onClose}
    >
      <div className="rounded-md border border-border/60 p-3">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Packing details
        </h4>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Packed quantity / cartons">
            <input className={inputCls} value={f.cartonCount} onChange={(e) => set("cartonCount", e.target.value)} placeholder="Number of cartons / packages" />
          </Field>
          <Field label="Package type (if relevant)">
            <input className={inputCls} value={f.packageType} onChange={(e) => set("packageType", e.target.value)} placeholder="Carton / pallet / bag…" />
          </Field>
          <Field label="Gross weight (if relevant)">
            <div className="flex gap-2">
              <input className={inputCls} value={f.grossWeight} onChange={(e) => set("grossWeight", e.target.value)} placeholder="Weight" />
              <select className={inputCls} value={f.grossWeightUnit} onChange={(e) => set("grossWeightUnit", e.target.value)}>
                <option value="kg">kg</option>
                <option value="quintal">quintal</option>
                <option value="tonne">tonne</option>
              </select>
            </div>
          </Field>
          <Field label="Planned dispatch date / time">
            <input type="datetime-local" className={inputCls} value={f.plannedDispatchAt} onChange={(e) => set("plannedDispatchAt", e.target.value)} />
          </Field>
          <Field label="Special handling instructions" wide>
            <input className={inputCls} value={f.handlingInstructions} onChange={(e) => set("handlingInstructions", e.target.value)} placeholder="Fragile, keep dry…" />
          </Field>
          <Field label="Internal dispatch notes" wide>
            <input className={inputCls} value={f.internalDispatchNotes} onChange={(e) => set("internalDispatchNotes", e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="rounded-md border border-border/60 p-3">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Transport details
        </h4>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Transport mode">
            <select className={inputCls} value={f.transportMode} onChange={(e) => set("transportMode", e.target.value)}>
              {TRANSPORT_MODES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Transporter name">
            <input className={inputCls} value={f.transporterName} onChange={(e) => set("transporterName", e.target.value)} />
          </Field>
          <Field label="Transporter ID (if available)">
            <input className={inputCls} value={f.transporterId} onChange={(e) => set("transporterId", e.target.value)} placeholder="GSTIN / transporter ID" />
          </Field>
          <Field label="Approximate distance (km)">
            <input type="number" min="0" className={inputCls} value={f.distanceKm} onChange={(e) => set("distanceKm", e.target.value)} />
          </Field>
          <Field label="Vehicle number">
            <input className={inputCls} value={f.vehicleNumber} onChange={(e) => set("vehicleNumber", e.target.value)} placeholder="Or transport document below" />
          </Field>
          <Field label="Vehicle type (if relevant)">
            <input className={inputCls} value={f.vehicleType} onChange={(e) => set("vehicleType", e.target.value)} />
          </Field>
          <Field label="Transport document type">
            <select className={inputCls} value={f.transportDocType} onChange={(e) => set("transportDocType", e.target.value)}>
              <option value="">—</option>
              {TRANSPORT_DOC_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Transport document number">
            <input className={inputCls} value={f.transportDocNumber} onChange={(e) => set("transportDocNumber", e.target.value)} placeholder="Required when no vehicle number" />
          </Field>
          <Field label="Transport document date">
            <input type="date" className={inputCls} value={f.transportDocDate} onChange={(e) => set("transportDocDate", e.target.value)} />
          </Field>
          <Field label="Driver name / mobile (if available)">
            <div className="flex gap-2">
              <input className={inputCls} value={f.driverName} onChange={(e) => set("driverName", e.target.value)} placeholder="Name" />
              <input className={inputCls} value={f.driverMobile} onChange={(e) => set("driverMobile", e.target.value)} placeholder="Mobile" />
            </div>
          </Field>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <button
          onClick={() => save.mutate(true)}
          disabled={save.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-sem-success/50 px-3 py-1.5 text-xs font-medium text-sem-success hover:bg-sem-success/10 disabled:opacity-50"
        >
          {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Submit Dispatch Details to Finance
        </button>
        <button
          onClick={() => save.mutate(false)}
          disabled={save.isPending}
          className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary disabled:opacity-50"
        >
          Save draft only
        </button>
      </div>
    </ModalShell>
  );
}

// ─── Record E-Way Bill (Finance) ────────────────────────────────────────────
export function RecordEwbModal({
  dispatch,
  invoice,
  onClose,
  onDone,
}: {
  dispatch: any;
  /** Linked sales invoice (optional) — pre-fills the recipient GSTIN for API generation. */
  invoice?: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"generate" | "api" | "notRequired">("generate");
  const [ewbNumber, setEwbNumber] = useState(dispatch.eway_bill_number ?? "");
  const [generatedAt, setGeneratedAt] = useState("");
  const [validUntil, setValidUntil] = useState(dispatch.eway_bill_valid_until?.slice(0, 10) ?? "");
  const [notRequiredReason, setNotRequiredReason] = useState("");
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [sendBackReason, setSendBackReason] = useState("");
  // API-generation inputs (NIC E-Way Bill API via stored credentials).
  const [supplierGstin, setSupplierGstin] = useState("");
  const [recipientGstin, setRecipientGstin] = useState(
    invoice?.buyer_gstin ?? invoice?.buyerGstin ?? "",
  );
  const [distance, setDistance] = useState(
    dispatch.distance_km != null ? String(dispatch.distance_km) : "",
  );
  const [vehicleNumber, setVehicleNumber] = useState(dispatch.vehicle_number ?? "");
  const [transporterName, setTransporterName] = useState(dispatch.transporter_name ?? "");
  const [transporterGstin, setTransporterGstin] = useState(dispatch.transporter_id ?? "");

  const record = useMutation({
    mutationFn: () =>
      api.goodsDispatches.recordEwb(dispatch.id, {
        ewbNumber: ewbNumber.trim(),
        generatedAt: generatedAt || undefined,
        validUntil: validUntil || undefined,
      }),
    onSuccess: () => {
      toast.success("E-Way Bill recorded — dispatch is ready for physical dispatch");
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const markNotRequired = useMutation({
    mutationFn: () =>
      api.goodsDispatches.recordEwb(dispatch.id, {
        notRequired: true,
        reason: notRequiredReason.trim(),
      }),
    onSuccess: () => {
      toast.success("Marked E-Way Bill not required (reason recorded)");
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // Generate via the NIC E-Way Bill API, then record the returned number
  // through the standard path so dispatch status + invoice mirroring apply.
  // The API requires a confirmed (non-draft) dispatch.
  const [generating, setGenerating] = useState(false);
  const generateViaApi = async () => {
    if (!supplierGstin.trim() || !recipientGstin.trim()) {
      toast.error("Enter both supplier and recipient GSTINs to generate via API");
      return;
    }
    setGenerating(true);
    try {
      const res: any = await api.ewayBill.generate({
        dispatchId: dispatch.id,
        supplierGstin: supplierGstin.trim(),
        recipientGstin: recipientGstin.trim(),
        distance: distance ? Number(distance) : undefined,
        transportMode: String(dispatch.transport_mode || "road").toLowerCase(),
        vehicleNumber: vehicleNumber.trim() || undefined,
        transporterGstin: transporterGstin.trim() || undefined,
        transporterName: transporterName.trim() || undefined,
      });
      const ewbNo = String(res?.ewayBill?.ewbNumber ?? res?.gspResult?.ewbNo ?? "").trim();
      if (!/^\d{8,16}$/.test(ewbNo)) throw new Error("API did not return an E-Way Bill number");
      await api.goodsDispatches.recordEwb(dispatch.id, { ewbNumber: ewbNo });
      toast.success(`E-Way Bill ${ewbNo} generated — dispatch is ready for physical dispatch`);
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setGenerating(false);
    }
  };

  const sendBack = useMutation({
    mutationFn: () => api.goodsDispatches.sendBack(dispatch.id, sendBackReason.trim()),
    onSuccess: () => {
      toast.success("Sent back to Warehouse for correction");
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <ModalShell
      title="Generate E-Way Bill"
      subtitle={`Invoice, IRN and warehouse dispatch details for ${dispatch.dispatch_number} are pre-filled — record the EWB number returned by Tally.`}
      onClose={onClose}
    >
      <div className="mb-3 grid grid-cols-2 gap-3 rounded-md border border-border/60 p-3 text-xs">
        <div>
          <span className="text-muted-foreground">Invoice:</span>{" "}
          {dispatch.linked_sales_invoice_number ?? "—"}
        </div>
        <div>
          <span className="text-muted-foreground">Transporter:</span>{" "}
          {dispatch.transporter_name ?? "—"}
        </div>
        <div>
          <span className="text-muted-foreground">Mode / distance:</span>{" "}
          {dispatch.transport_mode ?? "—"} · {dispatch.distance_km ?? "—"} km
        </div>
        <div>
          <span className="text-muted-foreground">Vehicle / doc:</span>{" "}
          {dispatch.vehicle_number || dispatch.transport_doc_number || "—"}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setMode("generate")}
          className={`rounded-md border px-3 py-1.5 text-xs ${mode === "generate" ? "border-primary text-primary" : "border-border"}`}
        >
          Enter EWB number
        </button>
        <button
          onClick={() => setMode("api")}
          className={`rounded-md border px-3 py-1.5 text-xs ${mode === "api" ? "border-primary text-primary" : "border-border"}`}
        >
          Generate via API
        </button>
        <button
          onClick={() => setMode("notRequired")}
          className={`rounded-md border px-3 py-1.5 text-xs ${mode === "notRequired" ? "border-primary text-primary" : "border-border"}`}
        >
          EWB not required
        </button>
      </div>

      {mode === "generate" ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="E-Way Bill number">
            <input className={inputCls} value={ewbNumber} onChange={(e) => setEwbNumber(e.target.value)} placeholder="Numeric EWB from Tally" />
          </Field>
          <Field label="Generation date / time">
            <input type="datetime-local" className={inputCls} value={generatedAt} onChange={(e) => setGeneratedAt(e.target.value)} />
          </Field>
          <Field label="Validity until" wide>
            <input type="date" className={inputCls} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </Field>
        </div>
      ) : mode === "api" ? (
        <div className="grid grid-cols-2 gap-3">
          {dispatch.status === "draft" ? (
            <p className="col-span-2 rounded-md border border-sem-attention/40 bg-sem-attention/10 p-2 text-[11px] text-sem-attention">
              Confirm the dispatch first — the NIC API generates E-Way Bills only for confirmed dispatches.
            </p>
          ) : (
            <p className="col-span-2 text-[11px] text-muted-foreground">
              Generates the E-Way Bill on the NIC portal using your stored API credentials, then records the
              number on the dispatch and the linked invoice (the downloaded invoice PDF prints it).
            </p>
          )}
          <Field label="Supplier GSTIN *">
            <input className={inputCls} value={supplierGstin} onChange={(e) => setSupplierGstin(e.target.value)} placeholder="Your 15-digit GSTIN" maxLength={15} />
          </Field>
          <Field label="Recipient GSTIN *">
            <input className={inputCls} value={recipientGstin} onChange={(e) => setRecipientGstin(e.target.value)} placeholder="Buyer 15-digit GSTIN" maxLength={15} />
          </Field>
          <Field label="Distance (km)">
            <input type="number" min="1" className={inputCls} value={distance} onChange={(e) => setDistance(e.target.value)} placeholder={String(dispatch.distance_km ?? 100)} />
          </Field>
          <Field label="Vehicle number">
            <input className={inputCls} value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} placeholder="KA01AB1234" />
          </Field>
          <Field label="Transporter name">
            <input className={inputCls} value={transporterName} onChange={(e) => setTransporterName(e.target.value)} placeholder="Transporter" />
          </Field>
          <Field label="Transporter GSTIN / TRANSIN">
            <input className={inputCls} value={transporterGstin} onChange={(e) => setTransporterGstin(e.target.value)} placeholder="Optional" maxLength={15} />
          </Field>
        </div>
      ) : (
        <Field label="Authorised reason (required)" wide>
          <input className={inputCls} value={notRequiredReason} onChange={(e) => setNotRequiredReason(e.target.value)} placeholder="e.g. consignment value below threshold / exempt goods" />
        </Field>
      )}

      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        {mode === "api" ? (
          <button
            onClick={generateViaApi}
            disabled={generating || dispatch.status === "draft"}
            className="inline-flex items-center gap-1.5 rounded-md border border-sem-success/50 px-3 py-1.5 text-xs font-medium text-sem-success hover:bg-sem-success/10 disabled:opacity-50"
          >
            {generating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileCheck className="h-3.5 w-3.5" />
            )}
            Generate E-Way Bill
          </button>
        ) : (
          <button
            onClick={() => (mode === "generate" ? record.mutate() : markNotRequired.mutate())}
            disabled={record.isPending || markNotRequired.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-sem-success/50 px-3 py-1.5 text-xs font-medium text-sem-success hover:bg-sem-success/10 disabled:opacity-50"
          >
            {record.isPending || markNotRequired.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileCheck className="h-3.5 w-3.5" />
            )}
            {mode === "generate" ? "Record E-Way Bill" : "Mark Not Required"}
          </button>
        )}
        <button
          onClick={() => setSendBackOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-md border border-sem-attention/40 px-3 py-1.5 text-xs font-medium text-sem-attention hover:bg-sem-attention/10"
        >
          <Undo2 className="h-3.5 w-3.5" /> Send back for correction
        </button>
        {sendBackOpen && (
          <div className="flex w-full gap-2">
            <input
              className={inputCls}
              value={sendBackReason}
              onChange={(e) => setSendBackReason(e.target.value)}
              placeholder="What must Warehouse correct? (required)"
            />
            <button
              onClick={() => {
                if (sendBackReason.trim()) sendBack.mutate();
              }}
              disabled={sendBack.isPending || !sendBackReason.trim()}
              className="shrink-0 rounded-md border border-sem-attention/40 px-3 py-1.5 text-xs font-medium text-sem-attention disabled:opacity-50"
            >
              {sendBack.isPending ? "Sending…" : "Confirm send-back"}
            </button>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

// ─── Confirm physical dispatch with actuals ────────────────────────────────
export function ConfirmDispatchModal({
  dispatch,
  onClose,
  onDone,
}: {
  dispatch: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  const [actualDispatchedAt, setActualDispatchedAt] = useState(nowLocal);
  const [actualVehicleNumber, setActualVehicleNumber] = useState(dispatch.vehicle_number ?? "");
  const [lrNumber, setLrNumber] = useState(dispatch.transport_doc_number ?? "");
  const packedDefault = (dispatch.lines ?? []).reduce(
    (s: number, l: any) => s + (l.dispatched_qty ?? 0),
    0,
  );
  const [actualPackedQty, setActualPackedQty] = useState<string>(String(packedDefault));

  const confirm = useMutation({
    mutationFn: () =>
      api.goodsDispatches.confirm(dispatch.id, {
        actualDispatchedAt: new Date(actualDispatchedAt).toISOString(),
        actualVehicleNumber: actualVehicleNumber || null,
        actualPackedQty: Number(actualPackedQty) || null,
        lrNumber: lrNumber || null,
      }),
    onSuccess: () => {
      toast.success("Dispatch confirmed — released for picking. Move to Dispatched to debit stock");
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <ModalShell
      title="Confirm Physical Dispatch"
      subtitle="Confirming releases the order for picking — inventory debits only when the status moves to Dispatched."
      onClose={onClose}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Actual dispatch date / time" wide>
          <input type="datetime-local" className={inputCls} value={actualDispatchedAt} onChange={(e) => setActualDispatchedAt(e.target.value)} />
        </Field>
        <Field label="Actual vehicle number (if changed)">
          <input className={inputCls} value={actualVehicleNumber} onChange={(e) => setActualVehicleNumber(e.target.value)} />
        </Field>
        <Field label="Actual packed quantity handed to transporter">
          <input type="number" min="0" className={inputCls} value={actualPackedQty} onChange={(e) => setActualPackedQty(e.target.value)} />
        </Field>
        <Field label="LR / GR / AWB number (if applicable)" wide>
          <input className={inputCls} value={lrNumber} onChange={(e) => setLrNumber(e.target.value)} />
        </Field>
      </div>
      <div className="flex gap-2 border-t border-border pt-3">
        <button
          onClick={() => confirm.mutate()}
          disabled={confirm.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-sem-success/50 px-3 py-1.5 text-xs font-medium text-sem-success hover:bg-sem-success/10 disabled:opacity-50"
        >
          {confirm.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <PackageCheck className="h-3.5 w-3.5" />
          )}
          Confirm dispatch (release for picking)
        </button>
      </div>
    </ModalShell>
  );
}

// ─── Awaiting Pickup transporter/upload form ───────────────────────────────
// Opened when the pipeline moves to Awaiting Pickup: transporter + vehicle /
// transport-document details are mandatory and become visible to Finance.
export function AwaitingPickupTransportModal({
  dispatch,
  onClose,
  onDone,
}: {
  dispatch: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const [f, setF] = useState({
    transporterName: dispatch.transporter_name ?? "",
    transporterId: dispatch.transporter_id ?? "",
    transportMode: dispatch.transport_mode ?? "Road",
    distanceKm: dispatch.distance_km ?? "",
    vehicleNumber: dispatch.vehicle_number ?? "",
    vehicleType: dispatch.vehicle_type ?? "",
    transportDocType: dispatch.transport_doc_type ?? "",
    transportDocNumber: dispatch.transport_doc_number ?? dispatch.tracking_number ?? "",
    transportDocDate: dispatch.transport_doc_date ?? "",
    driverName: dispatch.driver_name ?? "",
    driverMobile: dispatch.driver_mobile ?? "",
    plannedDispatchAt: dispatch.planned_dispatch_at?.slice(0, 16) ?? "",
    notes: "",
  });
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      if (!String(f.transporterName).trim()) throw new Error("Transporter name is required");
      if (!String(f.transportMode).trim()) throw new Error("Transport mode is required");
      if (!(Number(f.distanceKm) > 0)) throw new Error("Approximate distance (km) is required");
      if (!String(f.vehicleNumber).trim() && !String(f.transportDocNumber).trim())
        throw new Error("Vehicle number or transport document number is required");
      return api.goodsDispatches.shippingStatus(dispatch.id, "awaiting_pick", {
        transporterName: f.transporterName.trim(),
        transporterId: f.transporterId.trim() || null,
        transportMode: f.transportMode,
        distanceKm: Number(f.distanceKm),
        vehicleNumber: f.vehicleNumber.trim() || null,
        vehicleType: f.vehicleType.trim() || null,
        transportDocType: f.transportDocType || null,
        transportDocNumber: f.transportDocNumber.trim() || null,
        transportDocDate: f.transportDocDate || null,
        driverName: f.driverName.trim() || null,
        driverMobile: f.driverMobile.trim() || null,
        plannedDispatchAt: f.plannedDispatchAt || null,
        trackingNumber: f.transportDocNumber.trim() || undefined,
        notes: f.notes.trim() || undefined,
      } as any);
    },
    onSuccess: () => {
      toast.success("Moved to Awaiting Pickup — transporter details visible to Finance");
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <ModalShell
      title="Awaiting Pickup — transporter details"
      subtitle={`Assign the transporter for ${dispatch.dispatch_number}. These details are fetched on the Finance Dispatch Orders tab.`}
      onClose={onClose}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Transporter name *">
          <input className={inputCls} value={f.transporterName} onChange={(e) => set("transporterName", e.target.value)} placeholder="e.g. Safexpress" />
        </Field>
        <Field label="Transporter ID / GSTIN">
          <input className={inputCls} value={f.transporterId} onChange={(e) => set("transporterId", e.target.value)} placeholder="e.g. 88AAECS4363H1ZA" />
        </Field>
        <Field label="Transport mode *">
          <select className={inputCls} value={f.transportMode} onChange={(e) => set("transportMode", e.target.value)}>
            {TRANSPORT_MODES.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="Approximate distance (km) *">
          <input type="number" min="0" className={inputCls} value={f.distanceKm} onChange={(e) => set("distanceKm", e.target.value)} />
        </Field>
        <Field label="Vehicle number">
          <input className={inputCls} value={f.vehicleNumber} onChange={(e) => set("vehicleNumber", e.target.value)} placeholder="Or transport document below" />
        </Field>
        <Field label="Vehicle type">
          <input className={inputCls} value={f.vehicleType} onChange={(e) => set("vehicleType", e.target.value)} />
        </Field>
        <Field label="Transport document type">
          <select className={inputCls} value={f.transportDocType} onChange={(e) => set("transportDocType", e.target.value)}>
            <option value="">—</option>
            {TRANSPORT_DOC_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="Transport document number">
          <input className={inputCls} value={f.transportDocNumber} onChange={(e) => set("transportDocNumber", e.target.value)} placeholder="LR / GR / AWB number" />
        </Field>
        <Field label="Transport document date">
          <input type="date" className={inputCls} value={f.transportDocDate} onChange={(e) => set("transportDocDate", e.target.value)} />
        </Field>
        <Field label="Planned pickup date / time">
          <input type="datetime-local" className={inputCls} value={f.plannedDispatchAt} onChange={(e) => set("plannedDispatchAt", e.target.value)} />
        </Field>
        <Field label="Driver name / mobile">
          <div className="flex gap-2">
            <input className={inputCls} value={f.driverName} onChange={(e) => set("driverName", e.target.value)} placeholder="Name" />
            <input className={inputCls} value={f.driverMobile} onChange={(e) => set("driverMobile", e.target.value)} placeholder="Mobile" />
          </div>
        </Field>
        <Field label="Note for Finance">
          <input className={inputCls} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Optional" />
        </Field>
      </div>
      <div className="flex gap-2 border-t border-border pt-3">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-sem-success/50 px-3 py-1.5 text-xs font-medium text-sem-success hover:bg-sem-success/10 disabled:opacity-50"
        >
          {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Truck className="h-3.5 w-3.5" />}
          Save & move to Awaiting Pickup
        </button>
      </div>
    </ModalShell>
  );
}

// ─── Dispatch status date timeline (timeline-derived, no DB change) ────────
// Shows one dated row per shipping-pipeline stage ("Picking on 18 Sep…").
// Dates come from the per-document activity timeline (latest entry whose
// new_status matches the stage); the current stage falls back to
// shipping_status_at, plus dispatch-level fallbacks (created_at,
// actual_dispatched_at, delivered_at…). Re-renders automatically because it
// shares the ["timeline", "dispatch", id] query with DocumentTimelinePanel.
const JOURNEY_STAGES = [
  { key: "picking", label: "Picking" },
  { key: "packed", label: "Packed" },
  { key: "awaiting_pick", label: "Awaiting Pickup" },
  { key: "dispatched", label: "Dispatched" },
  { key: "in_transit", label: "In Transit" },
  { key: "delivered", label: "Delivered" },
] as const;

function fmtJourneyDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${date} · ${time}`;
}

export function DispatchStatusTimeline({ dispatch }: { dispatch: any }) {
  const d = dispatch ?? {};
  const docId = d.id as string | undefined;

  const q = useQuery({
    queryKey: ["timeline", "dispatch", docId],
    queryFn: () => api.timeline.list("dispatch", docId as string),
    enabled: !!docId,
  });
  const entries: any[] = q.data?.entries ?? [];

  // Latest timeline entry per new_status (status_change / system / assignment).
  const latestByStatus = new Map<string, any>();
  for (const e of entries) {
    const ns = String(e?.new_status ?? "").toLowerCase();
    if (!ns) continue;
    const prev = latestByStatus.get(ns);
    if (!prev || String(e.created_at ?? "") >= String(prev.created_at ?? "")) {
      latestByStatus.set(ns, e);
    }
  }

  const ship: string | null =
    d.shipping_status ?? d.shippingStatus ?? d.shippingstatus ?? null;
  const order = JOURNEY_STAGES.map((s) => s.key);
  let currentIdx = ship ? order.indexOf(String(ship).toLowerCase() as any) : -1;
  if (currentIdx < 0 && !ship) {
    // Legacy dispatches without a shipping_status: infer rough progress from
    // the document status so the timeline isn't entirely grey.
    const st = String(d.status ?? "").toLowerCase();
    if (st === "delivered") currentIdx = 5;
    else if (st === "partially_delivered") currentIdx = 3;
    else if (st === "confirmed" || st === "ready_for_dispatch") currentIdx = 0;
    else if (st === "details_submitted") currentIdx = 0;
  }

  const terminalKind = ["cancelled", "returned"].includes(String(d.status ?? "").toLowerCase())
    ? String(d.status).toLowerCase()
    : null;
  const terminalEntry =
    (terminalKind && latestByStatus.get(terminalKind)) || null;
  const terminalAt =
    terminalEntry?.created_at ??
    (terminalKind === "cancelled"
      ? (d.cancelled_at ?? d.cancelledAt ?? null)
      : (d.returned_at ?? d.returnedAt ?? null));

  const rows = JOURNEY_STAGES.map((s, i) => {
    const entry = latestByStatus.get(s.key) ?? null;
    let at: string | null = entry?.created_at ?? null;
    let by: string | null = entry?.actor_email ?? null;
    let note: string | null = entry?.text ?? null;
    // Current-stage fallback: the dispatch row always carries the last move.
    if (!at && ship && String(ship).toLowerCase() === s.key) {
      at = d.shipping_status_at ?? d.shippingStatusAt ?? null;
      by = by ?? d.shipping_status_by ?? d.shippingStatusBy ?? null;
    }
    // Stage-specific dispatch-level fallbacks for old docs with no timeline.
    if (!at && s.key === "dispatched") {
      at = d.actual_dispatched_at ?? d.actualDispatchedAt ?? d.debited_at ?? d.debitedAt ?? at;
    }
    if (!at && s.key === "delivered") {
      at = d.delivered_at ?? d.deliveredAt ?? d.delivery_date ?? d.deliveryDate ?? at;
    }
    if (i === 0 && !at) {
      at = d.created_at ?? d.createdAt ?? at;
    }
    const done = !!at;
    const isCurrent = !terminalKind && i === currentIdx;
    return { ...s, i, at, by, note, done, isCurrent };
  });

  return (
    <div className="rounded-lg border border-border/60 p-4">
      <div className="mb-3 flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-muted-foreground" />
        <h4 className="text-sm font-semibold">Dispatch journey</h4>
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          dates update as the status changes
        </span>
        {q.isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
      <ol className="relative ml-1.5 space-y-0 border-l border-border pl-5">
        <li className="relative pb-3">
          <span className="absolute -left-[27px] top-0.5 h-2.5 w-2.5 rounded-full bg-sem-success ring-4 ring-sem-success/15" />
          <div className="text-xs font-medium">Created</div>
          <div className="text-[11px] text-muted-foreground">
            {fmtJourneyDateTime(d.created_at ?? d.createdAt) ?? "—"}
          </div>
        </li>
        {rows.map((r) => (
          <li key={r.key} className="relative pb-3 last:pb-0">
            <span
              className={`absolute -left-[27px] top-0.5 h-2.5 w-2.5 rounded-full ring-4 ${
                r.done
                  ? "bg-sem-success ring-sem-success/15"
                  : r.isCurrent
                    ? "bg-primary ring-primary/15"
                    : "bg-muted ring-muted/40"
              }`}
            />
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className={`text-xs font-medium ${r.done ? "" : "text-muted-foreground"}`}>
                {r.label}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {r.at ? `on ${fmtJourneyDateTime(r.at)}` : "— pending"}
              </span>
            </div>
            {r.at && r.by && (
              <div className="text-[10px] text-muted-foreground">by {r.by}</div>
            )}
            {r.at && r.note && (
              <div className="mt-0.5 max-w-full truncate text-[10px] text-muted-foreground" title={r.note}>
                {r.note}
              </div>
            )}
          </li>
        ))}
        {terminalKind && (
          <li className="relative pt-1">
            <span className="absolute -left-[27px] top-1.5 h-2.5 w-2.5 rounded-full bg-destructive ring-4 ring-destructive/15" />
            <div className="text-xs font-medium capitalize text-destructive">{terminalKind}</div>
            <div className="text-[11px] text-muted-foreground">
              {terminalAt ? `on ${fmtJourneyDateTime(terminalAt)}` : ""}
              {terminalEntry?.actor_email ? ` · by ${terminalEntry.actor_email}` : ""}
            </div>
            {terminalEntry?.text && (
              <div className="mt-0.5 text-[10px] text-muted-foreground">{terminalEntry.text}</div>
            )}
          </li>
        )}
      </ol>
      {!q.isLoading && entries.length === 0 && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          No status changes recorded yet — dates appear here after the first move.
        </p>
      )}
    </div>
  );
}

// Small shared display row used by parent pages
export function DispatchFlowHint({ dispatch }: { dispatch: any }) {
  const d = dispatch;
  const steps = [
    { key: "draft", label: "Draft", done: d.status !== "draft" },
    { key: "details", label: "Details submitted", done: ["details_submitted", "ready_for_dispatch", "confirmed", "partially_delivered", "delivered"].includes(d.status) },
    { key: "ewb", label: d.ewb_not_required ? "EWB not required" : "E-Way Bill", done: !!(d.eway_bill_number || d.ewb_not_required) },
    { key: "ready", label: "Ready", done: ["ready_for_dispatch", "confirmed", "partially_delivered", "delivered"].includes(d.status) },
    { key: "dispatched", label: "Dispatched", done: ["confirmed", "partially_delivered", "delivered"].includes(d.status) },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
      {steps.map((s, i) => (
        <span key={s.key} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-muted-foreground">→</span>}
          <span
            className={`rounded px-1.5 py-0.5 ${
              s.done
                ? "bg-sem-success/10 text-sem-success"
                : "bg-muted/60 text-muted-foreground"
            }`}
          >
            {s.label}
          </span>
        </span>
      ))}
    </div>
  );
}
