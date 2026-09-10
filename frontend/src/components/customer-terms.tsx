import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api-client";
import { Plus, X, Loader2, Star } from "lucide-react";
import { toast } from "sonner";

/**
 * Customer payment-terms manager (PDF §1).
 * Lists the approved terms for one debtor, with add / edit / deactivate /
 * set-default actions. Exactly one active term is the default.
 */

export type DispatchCondition = "no_check" | "advance_required" | "full_required";

export const DISPATCH_CONDITION_OPTIONS: Array<{ value: DispatchCondition; label: string }> = [
  { value: "no_check", label: "No payment required before dispatch" },
  { value: "advance_required", label: "Required advance must be received before dispatch" },
  { value: "full_required", label: "Full invoice amount must be received before dispatch" },
];

export function dispatchConditionLabel(v: unknown): string {
  return (
    DISPATCH_CONDITION_OPTIONS.find((o) => o.value === String(v))?.label ?? String(v ?? "—")
  );
}

export function termSummary(t: any): string {
  const adv = Number(t.advancePct ?? t.advance_pct ?? 0) || 0;
  const days = Number(t.balanceDueDays ?? t.balance_due_days ?? 0) || 0;
  if (adv >= 100) return "100% Advance";
  if (adv > 0) return `${adv}% Advance + Balance ${days > 0 ? `Net ${days}` : "before dispatch"}`;
  return days > 0 ? `Net ${days}` : "No advance";
}

export function CustomerTermsManager({ debtorId }: { debtorId: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);

  const termsQ = useQuery({
    queryKey: ["debtor-terms", debtorId],
    queryFn: () => api.debtors.terms.list(debtorId),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["debtor-terms", debtorId] });
    qc.invalidateQueries({ queryKey: ["debtors-full"] });
  };

  const setDefault = useMutation({
    mutationFn: (termId: string) => api.debtors.terms.setDefault(debtorId, termId),
    onSuccess: () => {
      invalidate();
      toast.success("Default term updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const remove = useMutation({
    mutationFn: (termId: string) => api.debtors.terms.delete(debtorId, termId),
    onSuccess: () => {
      invalidate();
      toast.success("Term removed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const toggleActive = useMutation({
    mutationFn: (t: any) =>
      api.debtors.terms.update(debtorId, t.id, { isActive: !(t.isActive !== false) }),
    onSuccess: () => {
      invalidate();
      toast.success("Term updated");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const terms: any[] = termsQ.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">
          Approved terms ({terms.filter((t) => t.isActive !== false).length})
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:border-primary hover:text-primary"
        >
          <Plus className="h-3.5 w-3.5" /> Add term
        </button>
      </div>

      {termsQ.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading terms…
        </div>
      ) : terms.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          No approved terms yet. Add one — payment terms are mandatory for new sales orders.
        </div>
      ) : (
        <div className="space-y-2">
          {terms.map((t) => {
            const active = t.isActive !== false;
            return (
              <div
                key={t.id}
                className={`rounded-md border px-3 py-2 text-sm ${active ? "border-border/70" : "border-border/40 opacity-60"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium">
                    {t.name ?? termSummary(t)}{" "}
                    {t.isDefault && (
                      <span className="ml-1 inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-primary">
                        <Star className="h-3 w-3" /> Default
                      </span>
                    )}
                    {!active && (
                      <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                        Inactive
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {active && !t.isDefault && (
                      <button
                        type="button"
                        title="Set as default"
                        onClick={() => setDefault.mutate(t.id)}
                        className="rounded border border-border px-2 py-0.5 text-[11px] hover:border-primary hover:text-primary"
                      >
                        Set default
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditing(t)}
                      className="rounded border border-border px-2 py-0.5 text-[11px] hover:border-primary hover:text-primary"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      title={active ? "Deactivate" : "Reactivate"}
                      onClick={() => toggleActive.mutate(t)}
                      className="rounded border border-border px-2 py-0.5 text-[11px] hover:border-primary hover:text-primary"
                    >
                      {active ? "Deactivate" : "Reactivate"}
                    </button>
                    <button
                      type="button"
                      title="Delete"
                      onClick={() => {
                        if (window.confirm(`Delete term "${t.name}"? Historic sales orders keep their snapshot.`))
                          remove.mutate(t.id);
                      }}
                      className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-destructive hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {termSummary(t)} · {dispatchConditionLabel(t.dispatchCondition ?? t.dispatch_condition)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(creating || editing) && (
        <TermModal
          initial={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            invalidate();
            setCreating(false);
            setEditing(null);
          }}
          debtorId={debtorId}
        />
      )}
    </div>
  );
}

function TermModal({
  debtorId,
  initial,
  onClose,
  onSaved,
}: {
  debtorId: string;
  initial?: any | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!initial;
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    advance_pct: String(initial?.advancePct ?? initial?.advance_pct ?? "0"),
    balance_due_days: String(initial?.balanceDueDays ?? initial?.balance_due_days ?? "30"),
    dispatch_condition: String(
      initial?.dispatchCondition ?? initial?.dispatch_condition ?? "no_check",
    ) as DispatchCondition,
    is_default: !!initial?.isDefault,
  });

  const adv = Number(form.advance_pct) || 0;
  const bal = 100 - adv;
  const valid = adv >= 0 && adv <= 100;

  const save = useMutation({
    mutationFn: async () => {
      if (!valid) throw new Error("Advance % must be between 0 and 100");
      const payload = {
        name: form.name.trim() || null,
        advancePct: adv,
        balancePct: Math.round(bal * 100) / 100,
        balanceDueDays: Number(form.balance_due_days) || 0,
        dispatchCondition: form.dispatch_condition,
        isDefault: form.is_default,
      };
      if (isEdit && initial) {
        await api.debtors.terms.update(debtorId, initial.id, payload);
      } else {
        await api.debtors.terms.create(debtorId, payload);
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? "Term updated" : "Term added");
      onSaved();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card shadow-vault"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="font-display text-lg">{isEdit ? "Edit term" : "Add payment term"}</h3>
          <button onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-4 p-5"
        >
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
              Term name
            </span>
            <input
              className="inp"
              maxLength={120}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. 30% Advance + Balance Net 30"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
                Advance %
              </span>
              <input
                type="number"
                min={0}
                max={100}
                step="0.5"
                className="inp"
                value={form.advance_pct}
                onChange={(e) => setForm({ ...form, advance_pct: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
                Balance due days
              </span>
              <input
                type="number"
                min={0}
                className="inp"
                value={form.balance_due_days}
                onChange={(e) => setForm({ ...form, balance_due_days: e.target.value })}
              />
            </label>
          </div>
          <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Balance: {Number.isFinite(bal) ? bal : "—"}% due{" "}
            {Number(form.balance_due_days) > 0
              ? `${form.balance_due_days} days after invoice date`
              : "on invoice date"}
            . Advance due on SO confirmation (V1).
          </div>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
              Dispatch condition
            </span>
            <select
              className="inp"
              value={form.dispatch_condition}
              onChange={(e) =>
                setForm({ ...form, dispatch_condition: e.target.value as DispatchCondition })
              }
            >
              {DISPATCH_CONDITION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_default}
              onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
            />
            Default term for this customer
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              disabled={save.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? "Save" : "Add term"}
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}
