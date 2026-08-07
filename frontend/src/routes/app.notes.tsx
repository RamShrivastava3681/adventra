import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader, Card, fmtMoney, fmtDate } from "@/components/ledger-ui";
import { Plus, Trash2, X, Loader2, Link2, Paperclip, FileMinus, FilePlus, Eye } from "lucide-react";
import { TableSkeleton } from "@/components/skeletons";
import { toast } from "sonner";
import { DocumentUploader, DocumentList, type DocMeta } from "@/components/document-uploader";
import { SearchableSelect } from "@/components/ui/searchable-select";

export const Route = createFileRoute("/app/notes")({
  component: NotesPage,
});

type Kind = "credit" | "debit";
type Status = "pending" | "approved" | "rejected" | "applied" | "void" | "issued";

const STATUS_LABEL: Record<Status, string> = {
  pending: "Pending checker",
  approved: "Approved · awaiting apply",
  rejected: "Rejected",
  applied: "Applied",
  void: "Void",
  issued: "Pending checker",
};

function statusClass(s: Status) {
  if (s === "applied") return "bg-primary/15 text-primary border-primary/30";
  if (s === "approved") return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
  if (s === "rejected") return "bg-destructive/10 text-destructive border-destructive/30";
  if (s === "void") return "bg-muted text-muted-foreground border-border";
  return "bg-amber-500/10 text-amber-400 border-amber-500/30";
}

function NotesPage() {
  const { user, isAdmin, isClient, isChecker, isTreasury } = useAuth();
  const canCreate = isAdmin || (isClient && !isChecker && !isTreasury);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<any | null>(null);
  const [filter, setFilter] = useState<"all" | Kind>("all");

  const notesQ = useQuery({
    queryKey: ["credit-debit-notes"],
    queryFn: async () => {
      const data = await api.creditDebitNotes.list();
      return (data ?? []).sort(
        (a: any, b: any) => new Date(b.note_date).getTime() - new Date(a.note_date).getTime(),
      );
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await api.creditDebitNotes.delete(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["credit-debit-notes"] });
      toast.success("Removed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const voidNote = useMutation({
    mutationFn: async (id: string) => {
      await api.creditDebitNotes.update(id, { status: "void" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["credit-debit-notes"] });
      toast.success("Voided");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const rows = notesQ.data ?? [];
  const filtered = filter === "all" ? rows : rows.filter((r: any) => r.kind === filter);
  const creditTotal = rows
    .filter((r: any) => r.kind === "credit")
    .reduce((s: number, r: any) => s + Number(r.amount), 0);
  const debitTotal = rows
    .filter((r: any) => r.kind === "debit")
    .reduce((s: number, r: any) => s + Number(r.amount), 0);
  const pendingCount = rows.filter(
    (r: any) => r.status === "pending" || r.status === "issued",
  ).length;
  const approvedCount = rows.filter((r: any) => r.status === "approved").length;
  const appliedCount = rows.filter((r: any) => r.status === "applied").length;

  return (
    <div>
      <PageHeader
        eyebrow="Adjustments"
        title="Credit & debit notes"
        description="Raise credit notes (refunds, discounts) and debit notes (extra charges, claims). Every note routes to the Checker desk for approval, then the Funding queue, where Treasury applies it — automatically adjusting the linked sales or purchase invoice."
        actions={
          canCreate ? (
            <button
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> New note
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
              Read-only · {isChecker ? "Checker" : isTreasury ? "Treasury" : "View"}
            </span>
          )
        }
      />

      <div className="space-y-6 p-6 md:p-10">
        <div className="grid gap-4 md:grid-cols-3">
          <Card title="Pending checker">
            <div className="num text-2xl text-amber-400">{pendingCount}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Awaiting maker–checker approval
            </div>
          </Card>
          <Card title="Approved · awaiting apply">
            <div className="num text-2xl text-emerald-400">{approvedCount}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Sitting in the funding queue for treasury
            </div>
          </Card>
          <Card title="Applied">
            <div className="num text-2xl text-primary">{appliedCount}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Adjustment posted to linked invoice
            </div>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card title="Credit notes (gross)">
            <div className="num text-xl">{fmtMoney(creditTotal)}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {rows.filter((r: any) => r.kind === "credit").length} notes — refunds & discounts
            </div>
          </Card>
          <Card title="Debit notes (gross)">
            <div className="num text-xl">{fmtMoney(debitTotal)}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {rows.filter((r: any) => r.kind === "debit").length} notes — extra charges & claims
            </div>
          </Card>
          <Card title="Total notes">
            <div className="num text-xl">{rows.length}</div>
            <div className="mt-1 text-xs text-muted-foreground">All-time</div>
          </Card>
        </div>

        <div className="flex items-center gap-2">
          {(["all", "credit", "debit"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`rounded-md border px-3 py-1.5 text-xs uppercase tracking-widest ${filter === k ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              {k === "all" ? "All notes" : k === "credit" ? "Credit" : "Debit"}
            </button>
          ))}
        </div>

        <Card>
          {notesQ.isLoading ? (
            <TableSkeleton rows={5} cols={10} />
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No notes yet.</div>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="table-premium w-full text-sm">
                <thead className="text-xs uppercase tracking-widest text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2 text-left font-normal">Date</th>
                    <th className="px-5 py-2 text-left font-normal">Type</th>
                    <th className="px-5 py-2 text-left font-normal">Number</th>
                    <th className="px-5 py-2 text-left font-normal">Counterparty</th>
                    <th className="px-5 py-2 text-left font-normal">Linked invoice</th>
                    <th className="px-5 py-2 text-left font-normal">Reason</th>
                    <th className="px-5 py-2 text-right font-normal">Docs</th>
                    <th className="px-5 py-2 text-right font-normal">Amount</th>
                    <th className="px-5 py-2 text-left font-normal">Status</th>
                    <th className="px-5 py-2 text-right font-normal" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r: any) => {
                    const link = r.invoice?.invoice_number
                      ? { kind: "Sale", num: r.invoice.invoice_number }
                      : r.purchase?.invoice_number
                        ? { kind: "Purchase", num: r.purchase.invoice_number }
                        : null;
                    const docs: DocMeta[] = Array.isArray(r.documents) ? r.documents : [];
                    const Icon = r.kind === "credit" ? FileMinus : FilePlus;
                    return (
                      <tr key={r.id} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-5 py-3">{fmtDate(r.note_date)}</td>
                        <td className="px-5 py-3">
                          <span
                            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-widest ${r.kind === "credit" ? "border-rose-500/30 text-rose-400" : "border-emerald-500/30 text-emerald-400"}`}
                          >
                            <Icon className="h-3 w-3" />
                            {r.kind}
                          </span>
                        </td>
                        <td className="px-5 py-3 font-mono text-xs">{r.note_number}</td>
                        <td className="px-5 py-3 text-muted-foreground">{r.counterparty ?? "—"}</td>
                        <td className="px-5 py-3">
                          {link ? (
                            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background/40 px-2 py-0.5 text-xs">
                              <Link2 className="h-3 w-3 text-primary" />
                              <span className="text-muted-foreground">{link.kind}</span>
                              <span className="font-mono">{link.num}</span>
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Unlinked</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-muted-foreground max-w-[220px] truncate">
                          {r.reason ?? "—"}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {docs.length > 0 ? (
                            <button
                              onClick={() => setViewing(r)}
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[10px] hover:border-primary hover:text-primary"
                            >
                              <Paperclip className="h-3 w-3" />
                              {docs.length}
                            </button>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right num">{fmtMoney(r.amount)}</td>
                        <td className="px-5 py-3">
                          <span
                            className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-widest ${statusClass(r.status)}`}
                          >
                            {STATUS_LABEL[r.status as Status] ?? r.status}
                          </span>
                          {canCreate && (r.status === "pending" || r.status === "issued") && (
                            <button
                              onClick={() => {
                                if (confirm("Void this note?")) voidNote.mutate(r.id);
                              }}
                              className="ml-2 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-destructive"
                            >
                              Void
                            </button>
                          )}
                        </td>

                        <td className="px-5 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            <Link
                              to="/app/note-preview/$id"
                              params={{ id: r.id }}
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary"
                              title="Preview & download PDF"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Link>
                            <button
                              onClick={() => setViewing(r)}
                              className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary"
                            >
                              View
                            </button>
                            {canCreate && (r.status === "pending" || r.status === "issued") && (
                              <button
                                onClick={() => {
                                  if (confirm("Delete this note?")) remove.mutate(r.id);
                                }}
                                className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:border-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {open && user && (
        <NewNoteModal
          userId={user.id}
          onClose={() => setOpen(false)}
          onCreated={() => qc.invalidateQueries({ queryKey: ["credit-debit-notes"] })}
        />
      )}

      {viewing && <NoteDetailModal note={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function NoteDetailModal({ note, onClose }: { note: any; onClose: () => void }) {
  const link = note.invoice?.invoice_number
    ? { kind: "Sales invoice", num: note.invoice.invoice_number }
    : note.purchase?.invoice_number
      ? { kind: "Purchase invoice", num: note.purchase.invoice_number }
      : null;
  const docs: DocMeta[] = Array.isArray(note.documents) ? note.documents : [];
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-border bg-card shadow-vault"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">
            {note.kind === "credit" ? "Credit" : "Debit"} note · {note.note_number}
          </h3>
          <button onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-5 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <Detail label="Date" value={fmtDate(note.note_date)} />
            <Detail label="Amount" value={fmtMoney(note.amount)} />
            <Detail label="Status" value={STATUS_LABEL[note.status as Status]} />
            <Detail label="Counterparty" value={note.counterparty ?? "—"} />
            <Detail label="Linked" value={link ? `${link.kind} · ${link.num}` : "Unlinked"} />
          </div>
          {note.reason && (
            <div>
              <div className="mb-1 text-xs uppercase tracking-widest text-muted-foreground">
                Reason
              </div>
              <p className="text-muted-foreground">{note.reason}</p>
            </div>
          )}
          <div>
            <div className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
              Attachments
            </div>
            <DocumentList docs={docs} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}

function NewNoteModal({
  userId,
  onClose,
  onCreated,
}: {
  userId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [mode, setMode] = useState<"generated" | "manual">("generated");
  const [form, setForm] = useState({
    kind: "credit" as Kind,
    note_number: "",
    note_date: new Date().toISOString().slice(0, 10),
    amount: "",
    reason: "",
    counterparty: "",
    link_kind: "none" as "none" | "sale" | "purchase",
    link_id: "",
    tax_rate: "0",
  });
  type Line = { description: string; quantity: number; unit_price: number };
  const [lines, setLines] = useState<Line[]>([{ description: "", quantity: 1, unit_price: 0 }]);
  const [docs, setDocs] = useState<DocMeta[]>([]);

  const tplQ = useQuery({
    queryKey: ["invoice-template", userId],
    queryFn: async () => {
      const data = await api.invoiceTemplates.get();
      return data;
    },
  });
  const currencySym = (tplQ.data?.currency_symbol as string) || "$";
  useEffect(() => {
    if (tplQ.data && form.tax_rate === "0") {
      setForm((f) => ({ ...f, tax_rate: String(tplQ.data!.default_tax_rate ?? 0) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tplQ.data?.default_tax_rate]);

  const subtotal = lines.reduce(
    (s, l) => s + Number(l.quantity || 0) * Number(l.unit_price || 0),
    0,
  );
  const taxAmount = (subtotal * Number(form.tax_rate || 0)) / 100;
  const generatedTotal = subtotal + taxAmount;
  useEffect(() => {
    if (mode === "generated") {
      setForm((f) =>
        Number(f.amount) === generatedTotal
          ? f
          : { ...f, amount: generatedTotal ? generatedTotal.toFixed(2) : "" },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, subtotal, taxAmount]);

  const salesQ = useQuery({
    queryKey: ["note-link-sales"],
    queryFn: async () => {
      const data = await api.invoices.list();
      return data
        .map((i: any) => ({
          id: i.id,
          invoice_number: i.invoiceNumber ?? i.invoice_number,
          amount: i.amount,
        }))
        .reverse()
        .slice(0, 200);
    },
  });
  const purchQ = useQuery({
    queryKey: ["note-link-purchases"],
    queryFn: async () => {
      const data = await api.purchaseInvoices.list();
      return data
        .map((i: any) => ({
          id: i.id,
          invoice_number: i.invoiceNumber ?? i.invoice_number,
          amount: i.amount,
        }))
        .reverse()
        .slice(0, 200);
    },
  });

  const linkOptions = useMemo(() => {
    if (form.link_kind === "sale") return salesQ.data ?? [];
    if (form.link_kind === "purchase") return purchQ.data ?? [];
    return [];
  }, [form.link_kind, salesQ.data, purchQ.data]);

  const create = useMutation({
    mutationFn: async () => {
      if (!form.note_number.trim()) throw new Error("Note number is required");
      if (form.link_kind !== "none" && !form.link_id) throw new Error("Select the linked invoice");
      const cleanLines = lines
        .filter((l) => l.description.trim() && Number(l.quantity) > 0)
        .map((l) => ({
          description: l.description.trim(),
          quantity: Number(l.quantity),
          unit_price: Number(l.unit_price),
          line_total: Number(l.quantity) * Number(l.unit_price),
        }));
      if (mode === "generated" && cleanLines.length === 0)
        throw new Error("Add at least one line item to generate a note.");
      const subTotal =
        mode === "generated"
          ? cleanLines.reduce((s, l) => s + l.line_total, 0)
          : Number(form.amount);
      const taxRateN = Number(form.tax_rate || 0);
      const taxAmtN = mode === "generated" ? (subTotal * taxRateN) / 100 : 0;
      const totalAmt = mode === "generated" ? subTotal + taxAmtN : Number(form.amount);
      if (!totalAmt || totalAmt <= 0) throw new Error("Amount must be > 0");

      const payload: any = {
        client_id: userId,
        kind: form.kind,
        note_number: form.note_number.trim(),
        note_date: form.note_date,
        amount: totalAmt,
        reason: form.reason || null,
        counterparty: form.counterparty || null,
        invoice_id: form.link_kind === "sale" && form.link_id ? form.link_id : null,
        purchase_invoice_id: form.link_kind === "purchase" && form.link_id ? form.link_id : null,
        documents: docs,
        source: mode,
        line_items: cleanLines,
        subtotal: subTotal,
        tax_rate: taxRateN,
        tax_amount: taxAmtN,
      };
      await api.creditDebitNotes.create(payload);
    },
    onSuccess: () => {
      onCreated();
      toast.success("Note submitted for checker approval");
      onClose();
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
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-3">
          <h3 className="font-display text-lg">New credit / debit note</h3>
          <button onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="space-y-4 p-5"
        >
          {/* Mode toggle */}
          <div className="rounded-md border border-border bg-background/40 p-1 grid grid-cols-2 gap-1">
            {(["generated", "manual"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-md px-3 py-2 text-[10px] uppercase tracking-widest transition ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {m === "generated" ? "Generate note" : "Manual entry"}
              </button>
            ))}
          </div>

          <L label="Type">
            <div className="grid grid-cols-2 gap-2">
              {(["credit", "debit"] as Kind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setForm({ ...form, kind: k })}
                  className={`rounded-md border px-3 py-2 text-sm capitalize ${form.kind === k ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                >
                  {k} note
                </button>
              ))}
            </div>
          </L>
          <div className="grid grid-cols-2 gap-3">
            <L label="Note number *">
              <input
                required
                className="inp"
                placeholder="CN-0001 / DN-0001"
                value={form.note_number}
                onChange={(e) => setForm({ ...form, note_number: e.target.value })}
              />
            </L>
            <L label="Date">
              <input
                required
                type="date"
                className="inp"
                value={form.note_date}
                onChange={(e) => setForm({ ...form, note_date: e.target.value })}
              />
            </L>
          </div>

          {mode === "generated" && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-widest text-primary">Line items</div>
                <button
                  type="button"
                  onClick={() =>
                    setLines([...lines, { description: "", quantity: 1, unit_price: 0 }])
                  }
                  className="text-[10px] uppercase tracking-widest text-primary hover:underline"
                >
                  + Add line
                </button>
              </div>
              <table className="table-premium w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left font-normal">Description</th>
                    <th className="w-16 text-right font-normal">Qty</th>
                    <th className="w-24 text-right font-normal">Rate</th>
                    <th className="w-24 text-right font-normal">Total</th>
                    <th className="w-6" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, idx) => (
                    <tr key={idx}>
                      <td className="py-1 pr-2">
                        <input
                          className="inp"
                          placeholder="Description"
                          value={l.description}
                          onChange={(e) =>
                            setLines(
                              lines.map((x, i) =>
                                i === idx ? { ...x, description: e.target.value } : x,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          className="inp text-right"
                          value={l.quantity}
                          onChange={(e) =>
                            setLines(
                              lines.map((x, i) =>
                                i === idx ? { ...x, quantity: Number(e.target.value) } : x,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          className="inp text-right"
                          value={l.unit_price}
                          onChange={(e) =>
                            setLines(
                              lines.map((x, i) =>
                                i === idx ? { ...x, unit_price: Number(e.target.value) } : x,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="py-1 pr-2 text-right num text-muted-foreground">
                        {currencySym}
                        {(Number(l.quantity || 0) * Number(l.unit_price || 0)).toFixed(2)}
                      </td>
                      <td className="py-1 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            setLines(lines.length > 1 ? lines.filter((_, i) => i !== idx) : lines)
                          }
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="ml-auto w-56 space-y-1 border-t border-border pt-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="num">
                    {currencySym}
                    {subtotal.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Tax %</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="inp h-7 w-20 text-right"
                    value={form.tax_rate}
                    onChange={(e) => setForm({ ...form, tax_rate: e.target.value })}
                  />
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Tax amount</span>
                  <span className="num">
                    {currencySym}
                    {taxAmount.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between border-t border-border pt-1 font-medium">
                  <span>Total</span>
                  <span className="num text-primary">
                    {currencySym}
                    {generatedTotal.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <L label={mode === "generated" ? "Amount (auto from line items)" : "Amount *"}>
              <input
                required
                type="number"
                step="0.01"
                min="0"
                readOnly={mode === "generated"}
                className={`inp ${mode === "generated" ? "opacity-70" : ""}`}
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </L>
            <L label="Counterparty">
              <input
                className="inp"
                placeholder="Debtor / supplier name"
                value={form.counterparty}
                onChange={(e) => setForm({ ...form, counterparty: e.target.value })}
              />
            </L>
          </div>
          <L label="Link to invoice">
            <select
              className="inp"
              value={form.link_kind}
              onChange={(e) =>
                setForm({
                  ...form,
                  link_kind: e.target.value as "none" | "sale" | "purchase",
                  link_id: "",
                })
              }
            >
              <option value="none">Not linked</option>
              <option value="sale">Sales invoice</option>
              <option value="purchase">Purchase invoice</option>
            </select>
          </L>
          {form.link_kind !== "none" && (
            <L label={form.link_kind === "sale" ? "Sales invoice" : "Purchase invoice"}>
              <SearchableSelect
                value={form.link_id}
                onChange={(v) => setForm({ ...form, link_id: v })}
                placeholder="Select…"
                options={linkOptions.map((o: any) => ({
                  value: o.id,
                  label: o.invoice_number,
                  hint: fmtMoney(Number(o.amount)),
                }))}
              />
            </L>
          )}
          <L label="Reason">
            <textarea
              rows={2}
              className="inp"
              placeholder="Short-shipment, pricing adjustment, quality claim…"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            />
          </L>
          <DocumentUploader
            userId={userId}
            scope="notes"
            docs={docs}
            onChange={setDocs}
            hint="Attach the signed note, supporting correspondence, or evidence."
          />

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              disabled={create.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Submit for approval
            </button>
          </div>
        </form>
        <style>{`.inp{width:100%;background:var(--color-input);border:1px solid var(--color-border);color:var(--color-foreground);border-radius:6px;padding:.55rem .75rem;font-size:.875rem}.inp:focus{outline:none;border-color:var(--color-primary);box-shadow:0 0 0 3px color-mix(in oklab,var(--color-primary) 25%,transparent)}`}</style>
      </div>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
