import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Send, FileCheck, Undo2, PackageCheck, Truck } from "lucide-react";

export const DispatchFlowIcons = { Truck, Send, FileCheck };
import api from "@/lib/api-client";

/**
 * Dispatch workflow forms (PDF-1):
 *  - DispatchPackingModal: warehouse fills packing + transport details and
 *    submits them to Finance ("Submit Dispatch Details to Finance").
 *  - RecordEwbModal: Finance records the E-Way Bill from Tally (or marks it
 *    "not required" with an authorised reason).
 *  - ConfirmDispatchModal: warehouse confirms the physical dispatch with
 *    actuals (date/time, vehicle, packed qty, LR number) — inventory debits.
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
  onClose,
  onDone,
}: {
  dispatch: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"generate" | "notRequired">("generate");
  const [ewbNumber, setEwbNumber] = useState(dispatch.eway_bill_number ?? "");
  const [generatedAt, setGeneratedAt] = useState("");
  const [validUntil, setValidUntil] = useState(dispatch.eway_bill_valid_until?.slice(0, 10) ?? "");
  const [notRequiredReason, setNotRequiredReason] = useState("");
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [sendBackReason, setSendBackReason] = useState("");

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

      <div className="flex gap-2">
        <button
          onClick={() => setMode("generate")}
          className={`rounded-md border px-3 py-1.5 text-xs ${mode === "generate" ? "border-primary text-primary" : "border-border"}`}
        >
          EWB generated
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
      ) : (
        <Field label="Authorised reason (required)" wide>
          <input className={inputCls} value={notRequiredReason} onChange={(e) => setNotRequiredReason(e.target.value)} placeholder="e.g. consignment value below threshold / exempt goods" />
        </Field>
      )}

      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
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
      toast.success("Physical dispatch confirmed — inventory debited");
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <ModalShell
      title="Confirm Physical Dispatch"
      subtitle="Confirming debits inventory from the selected warehouse — this cannot be undone."
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
          Confirm dispatch (debit stock)
        </button>
      </div>
    </ModalShell>
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
